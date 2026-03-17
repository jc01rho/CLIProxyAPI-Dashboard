CREATE TABLE IF NOT EXISTS admin_sessions (
    id BIGSERIAL PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    remember_me BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMPTZ,
    created_ip VARCHAR(255),
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash
    ON admin_sessions(token_hash);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at
    ON admin_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_revoked_at
    ON admin_sessions(revoked_at);
