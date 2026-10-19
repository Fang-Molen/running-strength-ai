-- OPT-IN ONLY. Not included by migrations/*.sql. Review/back up before applying
-- to the EXISTING app database. No production migration has been run.
CREATE TABLE IF NOT EXISTS coach_model_budget_account (
  account_key text PRIMARY KEY,
  cap_calls integer NOT NULL CHECK (cap_calls > 0),
  cap_micros numeric(30,0) NOT NULL CHECK (cap_micros > 0),
  cap_concurrent integer NOT NULL CHECK (cap_concurrent > 0),
  calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  charged_micros numeric(30,0) NOT NULL DEFAULT 0 CHECK (charged_micros >= 0),
  active integer NOT NULL DEFAULT 0 CHECK (active >= 0),
  blocked boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS coach_model_reservation (
  request_id text PRIMARY KEY,
  owner_id text NOT NULL,
  campaign_id text NOT NULL,
  binding_hash text NOT NULL,
  context_hash text NOT NULL,
  model_hash text NOT NULL,
  config_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('RESERVED','DISPATCHED','SETTLED','UNKNOWN','CANCELLED')),
  worst_micros numeric(30,0) NOT NULL CHECK (worst_micros > 0),
  booked_micros numeric(30,0) NOT NULL CHECK (booked_micros >= 0),
  receipt_hash text,
  usage_hash text,
  actual_micros numeric(30,0),
  reconciliation_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS coach_model_reservation_account (
  request_id text NOT NULL REFERENCES coach_model_reservation(request_id),
  account_key text NOT NULL REFERENCES coach_model_budget_account(account_key),
  PRIMARY KEY(request_id, account_key)
);
CREATE INDEX IF NOT EXISTS coach_model_reservation_account_key
  ON coach_model_reservation_account(account_key);
