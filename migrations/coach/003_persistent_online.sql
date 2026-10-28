-- OPT-IN migration, after 001 and 002. Never run against a real database implicitly.
-- Existing consents retain PER_REQUEST scope; this does not manufacture ongoing authorization.
BEGIN;
ALTER TABLE coach_explanation_consent ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'PER_REQUEST' CHECK(mode IN ('PER_REQUEST','PERSISTENT'));
ALTER TABLE coach_explanation_consent ADD COLUMN IF NOT EXISTS allowed_categories jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE coach_explanation_consent ADD COLUMN IF NOT EXISTS service_categories jsonb NOT NULL DEFAULT '["MODEL"]'::jsonb;
ALTER TABLE coach_explanation_consent ADD COLUMN IF NOT EXISTS authorization_basis text NOT NULL DEFAULT 'LEGACY_PER_REQUEST';
ALTER TABLE coach_explanation_snapshot DROP CONSTRAINT IF EXISTS coach_explanation_snapshot_consent_id_key;
ALTER TABLE coach_explanation_snapshot ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE coach_explanation_snapshot ADD COLUMN IF NOT EXISTS dependency_versions jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS coach_explanation_consent_subject_mode ON coach_explanation_consent(subject_id,athlete_id,mode,granted_at DESC);
CREATE TABLE IF NOT EXISTS coach_online_preference (
 subject_id text NOT NULL, athlete_id text NOT NULL REFERENCES coach_self_athlete(athlete_id),
 enabled boolean NOT NULL, updated_at timestamptz NOT NULL,
 PRIMARY KEY(subject_id,athlete_id)
);
CREATE TABLE IF NOT EXISTS coach_declared_source_revision (
 subject_id text NOT NULL, athlete_id text NOT NULL REFERENCES coach_self_athlete(athlete_id),
 source_key text NOT NULL, content_hash text NOT NULL, generation bigint NOT NULL CHECK(generation>0),
 updated_at timestamptz NOT NULL, PRIMARY KEY(subject_id,athlete_id,source_key)
);
-- Old snapshots used an athlete-wide generation and are not converted into proof of current facts.
-- Keep all data for audit; expire them during the transition.
UPDATE coach_explanation_snapshot SET revoked_at=COALESCE(revoked_at,now())
 WHERE NOT (payload ? 'dependencyVersions');
COMMIT;
