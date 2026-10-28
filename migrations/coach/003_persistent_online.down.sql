-- Isolated rollback rehearsal only. No data/history is deleted.
-- Preserve a copy of shared grants; reconstruct a unique legacy consent for each v2 snapshot.
BEGIN;
CREATE TABLE IF NOT EXISTS coach_consent_v2_rollback_archive AS SELECT * FROM coach_explanation_consent WITH NO DATA;
INSERT INTO coach_consent_v2_rollback_archive SELECT c.* FROM coach_explanation_consent c
 WHERE NOT EXISTS (SELECT 1 FROM coach_consent_v2_rollback_archive a WHERE a.consent_id=c.consent_id);
INSERT INTO coach_explanation_consent(consent_id,subject_id,athlete_id,purpose,disclosure_version,granted_at,expires_at,revoked_at,mode,authorization_basis)
 SELECT 'rollback:'||s.snapshot_id,s.subject_id,s.athlete_id,c.purpose,c.disclosure_version,c.granted_at,c.expires_at,COALESCE(c.revoked_at,now()),'PER_REQUEST','ROLLBACK_REVOKED'
 FROM coach_explanation_snapshot s JOIN coach_explanation_consent c ON c.consent_id=s.consent_id
 WHERE s.payload ? 'dependencyVersions'
 ON CONFLICT(consent_id) DO NOTHING;
UPDATE coach_explanation_snapshot SET consent_id='rollback:'||snapshot_id,
 payload=jsonb_set(jsonb_set(payload,'{consent,id}',to_jsonb('rollback:'||snapshot_id)),'{consent,revokedAt}',to_jsonb(now()::text))
 WHERE payload ? 'dependencyVersions';
-- Extra columns/tables remain as audit history and are ignored by the old application.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='coach_explanation_snapshot_consent_id_key') THEN
  ALTER TABLE coach_explanation_snapshot ADD CONSTRAINT coach_explanation_snapshot_consent_id_key UNIQUE(consent_id);
 END IF;
END $$;
COMMIT;
