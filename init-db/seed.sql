-- CLIProxy Dashboard — Default Model Pricing Seed
-- Auto-applied on first PostgreSQL boot (only when volume is empty).
-- Prices in USD per 1 million tokens. Update via: psql or Table Editor.

BEGIN;

INSERT INTO model_pricing (id, model_pattern, input_price_per_million, output_price_per_million, provider)
VALUES
  (1,  'gpt-4o',             2.5000,  10.0000, 'OpenAI'),
  (2,  'gpt-4o-mini',        0.1500,   0.6000, 'OpenAI'),
  (3,  'gpt-4-turbo',       10.0000,  30.0000, 'OpenAI'),
  (4,  'gpt-4',             30.0000,  60.0000, 'OpenAI'),
  (5,  'gpt-3.5-turbo',      0.5000,   1.5000, 'OpenAI'),
  (6,  'claude-3-5-sonnet',  3.0000,  15.0000, 'Anthropic'),
  (7,  'claude-3-sonnet',    3.0000,  15.0000, 'Anthropic'),
  (8,  'claude-3-opus',     15.0000,  75.0000, 'Anthropic'),
  (9,  'claude-3-haiku',     0.2500,   1.2500, 'Anthropic'),
  (10, 'claude-sonnet',      3.0000,  15.0000, 'Anthropic'),
  (11, 'claude-opus',       15.0000,  75.0000, 'Anthropic'),
  (12, 'claude-haiku',       0.2500,   1.2500, 'Anthropic'),
  (13, 'gemini-2.5-pro',     1.2500,  10.0000, 'Google'),
  (14, 'gemini-2.5-flash',   0.1500,   0.6000, 'Google'),
  (15, 'gemini-2.0-flash',   0.1000,   0.4000, 'Google'),
  (16, 'gemini-1.5-pro',     1.2500,   5.0000, 'Google'),
  (17, 'gemini-1.5-flash',   0.0750,   0.3000, 'Google')
ON CONFLICT (id) DO NOTHING;

-- Reset sequence so new entries get IDs starting after the seeds above
SELECT setval(
  pg_get_serial_sequence('model_pricing', 'id'),
  COALESCE((SELECT MAX(id) FROM model_pricing), 1)
);

COMMIT;
