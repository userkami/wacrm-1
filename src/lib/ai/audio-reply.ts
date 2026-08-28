import { synthesizeSpeech } from './tts'
import { supabaseAdmin } from './admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendMediaMessage } from '@/lib/whatsapp/meta-api'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import type { AiConfig } from './types'

// ============================================================
// Audio reply orchestration.
//
// Turns the chat provider's text reply into a WhatsApp voice note and
// delivers it to the customer:
//
//   1. synthesizeSpeech() → raw audio bytes (ElevenLabs or OpenAI).
//   2. Upload the bytes to the PUBLIC `chat-media` bucket under the
//      account-scoped path convention (`account-<id>/<ts>-voice.mp3`).
//      Meta fetches the public URL at send time — the same pattern the
//      inbox composer uses for outbound media — so the bot delivers
//      through the service role (the webhook has no auth.uid()).
//   3. sendMediaMessage({ kind: 'audio', link }) via Meta, with the same
//      phone-variant retry the text bot uses.
//   4. Persist the `ai_generated`, `content_type='audio'` message row.
//
// Throws on any failure — the auto-reply controller decides whether to
// bail to a text reply (its contract: a TTS hiccup should fall back to
// text, never silently drop the reply).
// ============================================================

const CHAT_MEDIA_BUCKET = 'chat-media'

export interface SendAudioReplyArgs {
  accountId: string
  conversationId: string
  contactId: string
  config: AiConfig
  /** The chat provider's generated reply text to synthesize. */
  text: string
}

export interface SendAudioReplyResult {
  whatsapp_message_id: string
  mediaUrl: string
}

export async function sendAudioReply(
  args: SendAudioReplyArgs,
): Promise<SendAudioReplyResult> {
  const { accountId, conversationId, contactId, config, text } = args

  const provider = config.ttsProvider
  const apiKey = config.ttsApiKey
  const voice = config.ttsVoice
  if (!provider || !apiKey || !voice) {
    throw new Error(
      'Audio reply requested but TTS is not configured (provider, key, voice).',
    )
  }

  // 1. Synthesize.
  const { buffer } = await synthesizeSpeech({ provider, apiKey, voice, text })

  // 2. Upload to the public chat-media bucket (account-scoped path).
  const db = supabaseAdmin()
  const path = buildAudioMediaPath(accountId)
  const { error: upErr } = await db.storage.from(CHAT_MEDIA_BUCKET).upload(
    path,
    buffer,
    { contentType: 'audio/mpeg', upsert: false, cacheControl: '3600' },
  )
  if (upErr) {
    throw new Error(`TTS audio upload failed: ${upErr.message}`)
  }
  const {
    data: { publicUrl: mediaUrl },
  } = db.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path)

  // 3. Send via Meta with phone-variant retry (mirrors engineSendText).
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }
  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }
  const { data: wacfg, error: wcErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single()
  if (wcErr || !wacfg) {
    throw new Error('WhatsApp not configured for this account')
  }
  const accessToken = decrypt(wacfg.access_token)

  const attempt = async (phone: string): Promise<string> => {
    const r = await sendMediaMessage({
      phoneNumberId: wacfg.phone_number_id,
      accessToken,
      to: phone,
      kind: 'audio',
      link: mediaUrl,
    })
    return r.messageId
  }

  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError
  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  // 4. Persist the AI voice-note message (ai_generated true; audio has no
  //    caption, so content_text stays null).
  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'bot',
    content_type: 'audio',
    content_text: null,
    media_url: mediaUrl,
    message_id: waMessageId,
    status: 'sent',
    ai_generated: true,
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: '[Voice message]',
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)

  return { whatsapp_message_id: waMessageId, mediaUrl }
}

/** Account-scoped object path in `chat-media`: `<account-id>/<ts>-voice.mp3`,
 *  matching the bucket's first-segment RLS convention (migration 023). */
export function buildAudioMediaPath(
  accountId: string,
  now: number = Date.now(),
): string {
  return `account-${accountId}/${now}-voice.mp3`
}