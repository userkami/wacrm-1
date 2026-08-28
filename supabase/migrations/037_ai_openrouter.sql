-- ============================================================
-- 037_ai_openrouter.sql — add OpenRouter as an AI provider
--
-- The BYO AI assistant previously accepted exactly two providers
-- ('openai', 'anthropic'); the `provider` CHECK constraints on both
-- `ai_configs` and `ai_usage_log` would reject an OpenRouter row.
-- OpenRouter is an OpenAI-compatible aggregator, so the app-side change
-- is a new adapter + letting the provider string through. This migration
-- just widens the two DB constraints to accept 'openrouter'.
--
-- We drop and re-create each constraint under an explicit name so the
-- drop is deterministic regardless of how it was originally created
-- (inline CHECK automarra names can differ across Postgres versions).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'openrouter'));

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'openrouter'));