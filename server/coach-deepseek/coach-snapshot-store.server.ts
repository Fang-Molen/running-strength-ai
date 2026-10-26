import { randomUUID } from 'node:crypto';
import type { LedgerDatabase } from '../../src/lib/coach/deepseek-ledger.server.ts';
import type { AuthorizedCoachSnapshot, CoachSnapshotRefs, VerifiedCoachSubject } from './lib/coach-service-contract.ts';
import { COACH_DISCLOSURE_VERSION, declarationQuote, type CoachSnapshotCreate, type CoachSnapshotCreated, type CoachSnapshotReference } from './lib/coach-declaration-contract.ts';
import { declarationCoachInput } from './lib/coach-declarations.ts';

const TTL = 10 * 60 * 1000;
export function createCoachSnapshotStore(db: LedgerDatabase, now = Date.now) {
  return {
    async subject(id: string): Promise<VerifiedCoachSubject> {
      if (!id || id === 'dev-user' || id.length > 200) throw Error('AUTH_REQUIRED');
      return db.transaction(async tx => {
        await tx.query('INSERT INTO coach_self_athlete(athlete_id,subject_id) VALUES($1,$2) ON CONFLICT(subject_id) DO NOTHING', [randomUUID(), id]);
        const [row] = await tx.query<{ athlete_id: string }>('SELECT athlete_id FROM coach_self_athlete WHERE subject_id=$1', [id]);
        if (!row) throw Error('ATHLETE_ACCESS_REQUIRED');
        return { id, verified: true, athleteIds: [row.athlete_id] };
      });
    },
    async create(subject: VerifiedCoachSubject, input: CoachSnapshotCreate): Promise<CoachSnapshotCreated> {
      const asOf = new Date(now()).toISOString(), expiresAt = new Date(now() + TTL).toISOString();
      const snapshotId = randomUUID(), consentId = randomUUID(), sourceVersion = randomUUID();
      const rawInput = declarationCoachInput(input);
      return db.transaction(async tx => {
        const [owner] = await tx.query<{ athlete_id: string }>('SELECT athlete_id FROM coach_self_athlete WHERE subject_id=$1 FOR UPDATE', [subject.id]);
        if (!owner || !subject.athleteIds.includes(owner.athlete_id)) throw Error('ATHLETE_ACCESS_REQUIRED');
        const snapshot: AuthorizedCoachSnapshot = {
          subjectId: subject.id, athleteId: owner.athlete_id, snapshotId, version: sourceVersion, asOf, latestEvidenceKnownAt: asOf, expiresAt, revokedAt: null, provenance: 'USER_DECLARED', declarations: input.declarations,
          scope: { purpose: 'coach_explanation', occurrenceIds: [...new Set([rawInput.brief.occurrenceId, rawInput.compare?.left.occurrenceId, rawInput.compare?.right.occurrenceId, ...(rawInput.series?.points.map(p => p.occurrenceId) ?? [])].filter((v): v is string => !!v))] },
          consent: { id: consentId, subjectId: subject.id, purpose: 'coach_explanation', grantedAt: asOf, expiresAt, revokedAt: null }, rawInput,
        };
        await tx.query(`INSERT INTO coach_explanation_consent(consent_id,subject_id,athlete_id,purpose,disclosure_version,granted_at,expires_at) VALUES($1,$2,$3,'coach_explanation',$4,$5,$6)`, [consentId, subject.id, owner.athlete_id, COACH_DISCLOSURE_VERSION, asOf, expiresAt]);
        await tx.query(`INSERT INTO coach_explanation_snapshot(snapshot_id,subject_id,athlete_id,consent_id,source_version,question,as_of,expires_at,provenance,declarations,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'USER_DECLARED',$9::jsonb,$10::jsonb)`, [snapshotId, subject.id, owner.athlete_id, consentId, sourceVersion, input.question, asOf, expiresAt, JSON.stringify(input.declarations), JSON.stringify(snapshot)]);
        // Advancing the current source version invalidates every earlier snapshot.
        await tx.query('UPDATE coach_self_athlete SET source_version=$2 WHERE subject_id=$1', [subject.id, sourceVersion]);
        return { ok: true, snapshotRef: { snapshotId, consentId, asOf }, expiresAt, sourceVersion, provenance: 'USER_DECLARED', disclosureVersion: COACH_DISCLOSURE_VERSION, factQuotes: input.declarations.map(declarationQuote) };
      });
    },
    async load(subject: VerifiedCoachSubject, refs: CoachSnapshotRefs): Promise<AuthorizedCoachSnapshot | null> {
      return db.transaction(async tx => {
        const [row] = await tx.query<{ payload: AuthorizedCoachSnapshot }>(`SELECT s.payload FROM coach_explanation_snapshot s
          JOIN coach_self_athlete a ON a.athlete_id=s.athlete_id AND a.subject_id=s.subject_id AND a.source_version=s.source_version
          JOIN coach_explanation_consent c ON c.consent_id=s.consent_id AND c.subject_id=s.subject_id AND c.athlete_id=s.athlete_id
          WHERE s.snapshot_id=$1 AND s.subject_id=$2 AND s.consent_id=$3 AND s.as_of=$4 AND s.question=$5
            AND s.expires_at>$6 AND c.expires_at>$6 AND c.revoked_at IS NULL AND c.purpose='coach_explanation'`,
        [refs.snapshotId, subject.id, refs.consentId, refs.asOf, refs.question, new Date(now()).toISOString()]);
        if (!row || !subject.athleteIds.includes(row.payload.athleteId)) return null;
        return row.payload;
      });
    },
    async revoke(subject: VerifiedCoachSubject, refs: CoachSnapshotReference): Promise<boolean> {
      return db.transaction(async tx => {
        const rows = await tx.query(`UPDATE coach_explanation_consent c SET revoked_at=COALESCE(c.revoked_at,$5::timestamptz)
          FROM coach_explanation_snapshot s, coach_self_athlete a
          WHERE s.snapshot_id=$1 AND s.subject_id=$2 AND s.consent_id=$3 AND s.as_of=$4
          AND c.consent_id=s.consent_id AND c.subject_id=$2 AND a.athlete_id=s.athlete_id AND a.subject_id=$2
          RETURNING c.consent_id`, [refs.snapshotId, subject.id, refs.consentId, refs.asOf, new Date(now()).toISOString()]);
        return rows.length > 0;
      });
    },
  };
}
