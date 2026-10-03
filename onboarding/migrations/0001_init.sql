-- Peak State accounts, strategies and reps (D-onboarding-017).
-- Apply locally: npx wrangler d1 migrations apply peak-state --local · remotely: --remote

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- Bearer sessions. Only the SHA-256 of the token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_account ON sessions(account_id);

-- One row per saved revision of a strategy record; old revisions are kept.
CREATE TABLE strategies (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  saved_at TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  PRIMARY KEY (account_id, profile_id, revision)
);
-- Which strategy is the account's current one. Moved only by a conditional update, so two devices cannot both win.
CREATE TABLE current_strategy (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every changed answer, keyed by the revision it produced.
CREATE TABLE strategy_changes (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  change_json TEXT NOT NULL,
  PRIMARY KEY (account_id, profile_id, revision)
);

-- Every logged run (contracts RepSession), owned by the account that ran it.
CREATE TABLE reps (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  state_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_by TEXT NOT NULL,
  intensity_after INTEGER,
  rep_json TEXT NOT NULL,
  PRIMARY KEY (account_id, id)
);
CREATE INDEX reps_state ON reps(account_id, state_id, started_at);

-- Daily counters: failed invite codes per client, voice keys per account.
CREATE TABLE counters (
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, day)
);
