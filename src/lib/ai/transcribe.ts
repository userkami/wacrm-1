import { AiError, type SttProvider } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { providerHttpError, toNetworkError } from './providers/shared'

// ============================================================
// Speech-to-text (Groq Whisper / OpenAI).
//
// Covers the optional transcription of inbound voice notes. Both
// providers are OpenAI-compatible (`POST /v1/audio/transcriptions`,
// multipart `file` + `model`), differing only in host + default model.
// Anthropic / OpenRouter have no transcription API, so they're excluded
// from `SttProvider`.
// ============================================================

const GPROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const OPENAI_STT_URL = 'https://api.openai.com/v1/audio/transcriptions'

/** Default STT model per provider (overridable via env). */
export function sttModelFor(provider: SttProvider): string {
  switch (provider) {
    case 'groq':
      return process.env.AI_STT_MODEL_GROQ || 'whisper-large-v3-turbo'
    case 'openai':
      return process.env.AI_STT_MODEL_OPENAI || 'gpt-4o-mini-transcribe'
  }
}

export interface TranscribeArgs {
  provider: SttProvider
  apiKey: string
  /** Raw audio bytes (what the media download returned). */
  buffer: Buffer
  /** e.g. 'audio/ogg', 'audio/mpeg', 'audio/mp4'. */
  mimeType: string
}

export interface TranscriptionResult {
  text: string
}

/**
 * Transcribe audio bytes to text using the configured STT provider.
 * Both endpoints are OpenAI-compatible: multipart form with a `file`
 * part (named "file", as OpenAI expects) and `model`. Throws `AiError`
 * on network / provider / empty result so callers surface gracefully.
 */
export async function transcribeAudio(
  args: TranscribeArgs,
): Promise<TranscriptionResult> {
  const { provider, apiKey, buffer, mimeType } = args
  const url = provider === 'groq' ? GPROQ_STT_URL : OPENAI_STT_URL

  // OpenAI-compatible transcription expects a Blob/File for the `file`
  // part. Look it like a filename the provider can sniff the format from;
  // the extension matters little — transcription is format-agnostic.
  const ext = extensionForMimeType(mimeType) ?? 'bin'
  const file = new Blob([buffer as unknown as BlobPart], { type: mimeType })
  const form = new FormData()
  form.append('file', file, `voice.${ext}`)
  form.append('model', sttModelFor(provider))
  form.append('response_format', 'json')

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(aiRequestTimeoutMs() * 2),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError(provider === 'openai' ? 'OpenAI' : 'Groq', res)
  }

  const data = (await res.json().catch(() => null)) as { text?: string } | null
  const text = data?.text?.trim()
  if (!text) {
    throw new AiError(
      `${provider === 'openai' ? 'OpenAI' : 'Groq'} returned an empty transcription.`,
      { code: 'empty_response' },
    )
  }
  return { text }
}

/** Map common audio MIME types to a file extension. Voice notes are
 *  typically Ogg/Opus (`audio/ogg`); outbound WhatsApp audio is MP3/AAC. */
function extensionForMimeType(mimeType: string): string | null {
  switch ((mimeType || '').toLowerCase()) {
    case 'audio/ogg':
    case 'audio/opus':
      return 'ogg'
    case 'audio/mpeg':
      return 'mp3'
    case 'audio/mp3':
      return 'mp3'
    case 'audio/mp4':
    case 'audio/aac':
      return 'm4a'
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav'
    case 'audio/amr':
      return 'amr'
    case 'audio/webm':
      return 'webm'
    default:
      return null
  }
}