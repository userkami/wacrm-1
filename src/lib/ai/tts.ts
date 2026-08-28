import { AiError, type TtsProvider } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { providerHttpError, toNetworkError } from './providers/shared'

// ============================================================
// Text-to-speech (ElevenLabs / OpenAI).
//
// Synthesizes the agent's reply into audio bytes that get uploaded to
// the `chat-media` bucket and delivered as a WhatsApp voice note.
// Anthropic / OpenRouter have no TTS API, so they're excluded from
// `TtsProvider`.
// ============================================================

const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech'
const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech'

/** Default TTS model per provider (overridable via env). */
export function ttsModelFor(provider: TtsProvider): string {
  switch (provider) {
    case 'elevenlabs':
      return process.env.AI_TTS_MODEL_ELEVENLABS || 'eleven_multilingual_v2'
    case 'openai':
      return process.env.AI_TTS_MODEL_OPENAI || 'gpt-4o-mini-audio-preview'
  }
}

export interface SynthesizeArgs {
  provider: TtsProvider
  apiKey: string
  /** Provider-specific voice id (ElevenLabs `voice_id` or OpenAI voice). */
  voice: string
  text: string
}

export interface SynthesisResult {
  /** Audio bytes, ready to upload to `chat-media`. */
  buffer: Buffer
  mimeType: string
}

/**
 * Turn reply text into audio bytes. Returns the raw bytes + MIME so the
 * caller can upload them as a WhatsApp voice note. Throws `AiError` on
 * network / provider / empty-result, matching the other AI adapters'
 * contract so callers handle failures uniformly.
 */
export async function synthesizeSpeech(
  args: SynthesizeArgs,
): Promise<SynthesisResult> {
  const { provider, apiKey, voice, text } = args
  const url =
    provider === 'elevenlabs'
      ? `${ELEVENLABS_URL}/${encodeURIComponent(voice)}`
      : OPENAI_SPEECH_URL

  let res: Response
  try {
    if (provider === 'elevenlabs') {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text, model_id: ttsModelFor(provider) }),
        signal: AbortSignal.timeout(aiRequestTimeoutMs() * 2),
      })
    } else {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: ttsModelFor(provider),
          voice,
          input: text,
          response_format: 'mp3',
        }),
        signal: AbortSignal.timeout(aiRequestTimeoutMs() * 2),
      })
    }
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError(
      provider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI',
      res,
    )
  }

  // TTS returns raw audio bytes (not JSON). ElevenLabs audio/mpeg; OpenAI
  // audio/mpeg for the mp3 response_format above.
  const arrayBuf = await res.arrayBuffer().catch(() => null)
  if (!arrayBuf || arrayBuf.byteLength === 0) {
    throw new AiError(
      `${provider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI'} returned empty audio.`,
      { code: 'empty_response' },
    )
  }
  return { buffer: Buffer.from(arrayBuf), mimeType: 'audio/mpeg' }
}