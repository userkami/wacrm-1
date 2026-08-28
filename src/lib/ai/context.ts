import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  /** Body text for text messages; caption for image/video/document. Null
   *  for audio (voice notes carry no caption). */
  content_text: string | null
  /** STT output for inbound voice notes (migration 038). Null otherwise. */
  transcript: string | null
}

/**
 * Fetch the last N relevant messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent and
 * bot messages become `assistant`.
 *
 * Rules:
 *  - `text` rows → the message text.
 *  - `audio` rows WITH a non-empty `transcript` → `[Voice message] <transcript>`
 *    so the model can respond to voice notes (and knowledge retrieval sees
 *    their content). Voice notes without a transcript (no STT key / failure)
 *    are excluded — there's nothing to model.
 *  - Everything else (image/video/document with no text/caption,
 *    templates, interactive) is excluded — it carries no text to model.
 *
 * Ordered oldest-first (chronological) so the transcript reads naturally
 * and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_type, content_text, transcript')
    .eq('conversation_id', conversationId)
    // Pull a wider window so we can derive text for audio-with-transcript
    // rows; the limit below still bounds what we return. (~5x headroom to
    // account for non-text rows that get filtered out.)
    .order('created_at', { ascending: false })
    .limit(Math.min(2_000, limit * 5))

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  const out: ChatMessage[] = []
  for (const m of rows) {
    const content = messageContentForModel(m)
    if (!content) continue
    if (out.length >= limit) break
    out.push({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content,
    })
  }
  return out
}

/** Derive the model-visible text for a message (non-text with no content →
 *  null, and such rows are skipped). Exported for unit tests. */
export function messageContentForModel(m: {
  content_type?: string | null
  content_text: string | null
  transcript: string | null
}): string | null {
  const kind = (m.content_type ?? 'text') as string
  if (kind === 'text') {
    const t = m.content_text?.trim()
    return t ? t : null
  }
  if (kind === 'audio') {
    const t = m.transcript?.trim()
    return t ? `[Voice: ${t}]` : null
  }
  return null
}
