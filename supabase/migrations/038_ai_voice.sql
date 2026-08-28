-- ============================================================
-- 038_ai_voice.sql — optional AI voice (STT + TTS) for the agent
--
-- Lets the AI agent speak. Two optional, independent capabilities,
-- each gated on a per-account key (stored AES-256-GCM-encrypted, same
-- as `ai_configs.api_key` / `embeddings_api_key`):
--
--   1. Speech-to-text (STT): when `stt_provider` + `stt_api_key` are set,
--      inbound WhatsApp voice notes (content_type='audio') are transcribed
--      and stored on `messages.transcript`, so the AI can reply to their
--      content and agents can read what the customer said.
--      Providers: Groq (Whisper) or OpenAI.
--
--   2. Text-to-speech (TTS): when `tts_provider` + `tts_api_key` (+ a
--      `tts_voice`) are set, the chat provider's text reply is synthesized
--      into audio and delivered back as a WhatsApp voice note.
--      Providers: ElevenLabs or OpenAI.
--
-- Everything is optional and off by default: keys null => behaviour is
-- identical to before this migration.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- STT output for an inbound voice message. Null for every other message
-- type (and for audio when no STT key is configured / transcription fails).
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS transcript text;

-- Per-account voice keys + preferences on the AI config. Keys are stored
-- AES-256-GCM-encrypted (client never reads them back; settings shows a
-- masked placeholder + has_key flag).
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS stt_provider text,
  ADD COLUMN IF NOT EXISTS stt_api_key text,
  ADD COLUMN IF NOT EXISTS tts_provider text,
  ADD COLUMN IF NOT EXISTS tts_api_key text,
  ADD COLUMN IF NOT EXISTS tts_voice text;

-- Constrain the provider pickers to known values. Drop-then-add under an
-- explicit name for idempotency (mirrors the 037 approach).
ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_stt_provider_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_stt_provider_check
  CHECK (stt_provider IN ('groq', 'openai'));

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_tts_provider_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_tts_provider_check
  CHECK (tts_provider IN ('elevenlabs', 'openai'));