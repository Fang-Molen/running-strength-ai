-- OPT-IN ONLY. Apply with 001 to the SAME reviewed application database.
-- No migration is run by the coach request path; existing user data is untouched.
CREATE TABLE IF NOT EXISTS coach_self_athlete (
  athlete_id text PRIMARY KEY,
  subject_id text NOT NULL UNIQUE,
  source_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS coach_explanation_consent (
  consent_id text PRIMARY KEY,
  subject_id text NOT NULL,
  athlete_id text NOT NULL REFERENCES coach_self_athlete(athlete_id),
  purpose text NOT NULL CHECK (purpose = 'coach_explanation'),
  disclosure_version text NOT NULL,
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > granted_at)
);
CREATE TABLE IF NOT EXISTS coach_explanation_snapshot (
  snapshot_id text PRIMARY KEY,
  subject_id text NOT NULL,
  athlete_id text NOT NULL REFERENCES coach_self_athlete(athlete_id),
  consent_id text NOT NULL UNIQUE REFERENCES coach_explanation_consent(consent_id),
  source_version text NOT NULL,
  question text NOT NULL,
  as_of timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  provenance text NOT NULL CHECK (provenance = 'USER_DECLARED'),
  declarations jsonb NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS coach_explanation_snapshot_owner ON coach_explanation_snapshot(subject_id, snapshot_id);
