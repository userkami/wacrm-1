// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI, Anthropic, or OpenRouter.
// ============================================================

export type AiProvider = 'openai' | 'anthropic' | 'openrouter'

/**
 * Optional speech-to-text providers for transcribing inbound voice notes.
 * Groq (Whisper) and OpenAI share an OpenAI-compatible transcription
 * endpoint; Anthropic / OpenRouter have no transcription API.
 */
export type SttProvider = 'groq' | 'openai'

/**
 * Optional text-to-speech providers for synthesizing the agent's reply
 * into a WhatsApp voice note.
 */
export type TtsProvider = 'elevenlabs' | 'openai'

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
  /** Optional voice transcription setup. When both are set, inbound
   *  voice notes are transcribed (Groq or OpenAI) so the AI can reply to
   *  their content. Null provider/key => no transcription (unchanged). */
  sttProvider?: SttProvider | null
  sttApiKey?: string | null
  /** Optional voice synthesis setup. When set, the chat provider's text
   *  reply is turned into an audio voice note (ElevenLabs or OpenAI).
   *  Null provider/key => replies stay text-only (unchanged). */
  ttsProvider?: TtsProvider | null
  ttsApiKey?: string | null
  /** Provider-specific voice/style id used for TTS (ElevenLabs voice_id
   *  or an OpenAI voice name). Ignored when tts is off. */
  ttsVoice?: string | null
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
