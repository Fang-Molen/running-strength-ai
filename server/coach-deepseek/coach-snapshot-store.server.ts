import { randomUUID, createHash } from 'node:crypto';
import type { LedgerDatabase } from '../../src/lib/coach/deepseek-ledger.server.ts';
import type { AuthorizedCoachSnapshot, CoachSnapshotRefs, VerifiedCoachSubject } from './lib/coach-service-contract.ts';
import { COACH_DISCLOSURE_VERSION, declarationQuote, contextRecordQuote, type CoachSnapshotCreate, type CoachSnapshotCreated, type CoachSnapshotReference } from './lib/coach-declaration-contract.ts';
import { declarationCoachInput } from './lib/coach-declarations.ts';

const TTL=10*60*1000, GRANT_TTL=365*86400000;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const categories=['TRAINING','STRENGTH','GOAL','PLAN','NUTRITION','RECOVERY','CAPABILITY','RESTRICTION','ANALYSIS','DIALOGUE'];
type ConsentRow={consent_id:string;granted_at:string|Date;expires_at:string|Date;revoked_at:string|Date|null};
const iso=(value:string|Date)=>new Date(value).toISOString();
export function createCoachSnapshotStore(db: LedgerDatabase, now = Date.now) {
  async function consent(tx:Parameters<Parameters<LedgerDatabase['transaction']>[0]>[0],subject:VerifiedCoachSubject,athleteId:string,mode:'PER_REQUEST'|'PERSISTENT',enable=false):Promise<ConsentRow>{
    const asOf=new Date(now()).toISOString();
    const [choice]=await tx.query<{enabled:boolean}>('SELECT enabled FROM coach_online_preference WHERE subject_id=$1 AND athlete_id=$2',[subject.id,athleteId]);
    if(choice?.enabled===false&&!enable)throw Error('CONSENT_REVOKED');
    if(mode==='PERSISTENT'){
      if(enable)await tx.query(`INSERT INTO coach_online_preference(subject_id,athlete_id,enabled,updated_at) VALUES($1,$2,true,$3) ON CONFLICT(subject_id,athlete_id) DO UPDATE SET enabled=true,updated_at=EXCLUDED.updated_at`,[subject.id,athleteId,asOf]);
      else await tx.query(`INSERT INTO coach_online_preference(subject_id,athlete_id,enabled,updated_at) VALUES($1,$2,true,$3) ON CONFLICT(subject_id,athlete_id) DO NOTHING`,[subject.id,athleteId,asOf]);
      const [preference]=await tx.query<{enabled:boolean}>('SELECT enabled FROM coach_online_preference WHERE subject_id=$1 AND athlete_id=$2',[subject.id,athleteId]);
      if(preference?.enabled!==true)throw Error('CONSENT_REVOKED');
      const [existing]=await tx.query<ConsentRow>(`SELECT consent_id,granted_at,expires_at,revoked_at FROM coach_explanation_consent WHERE subject_id=$1 AND athlete_id=$2 AND mode='PERSISTENT' AND disclosure_version=$3 ORDER BY revoked_at NULLS FIRST,granted_at DESC,consent_id DESC LIMIT 1`,[subject.id,athleteId,COACH_DISCLOSURE_VERSION]);
      if(existing?.revoked_at&&!enable)throw Error('CONSENT_REVOKED');
      if(existing&&!existing.revoked_at&&Date.parse(iso(existing.expires_at))>now())return existing;
      // Explicit settings enable may replace a revoked grant. Ordinary requests cannot do so.
      if(existing&&enable)await tx.query(`UPDATE coach_explanation_consent SET revoked_at=COALESCE(revoked_at,$2::timestamptz) WHERE consent_id=$1`,[existing.consent_id,asOf]);
    }
    const row:ConsentRow={consent_id:randomUUID(),granted_at:asOf,expires_at:new Date(now()+(mode==='PERSISTENT'?GRANT_TTL:TTL)).toISOString(),revoked_at:null};
    await tx.query(`INSERT INTO coach_explanation_consent(consent_id,subject_id,athlete_id,purpose,disclosure_version,granted_at,expires_at,mode,allowed_categories,service_categories,authorization_basis) VALUES($1,$2,$3,'coach_explanation',$4,$5,$6,$7,$8::jsonb,'["MODEL"]'::jsonb,$9)`,[row.consent_id,subject.id,athleteId,COACH_DISCLOSURE_VERSION,row.granted_at,row.expires_at,mode,JSON.stringify(categories),mode==='PERSISTENT'?'AUTHENTICATED_ONLINE_SETTING':'EXPLICIT_PER_REQUEST']);
    return row;
  }
  return {
    /** Schema metadata only: no account, snapshot content, or model dispatch. */
    async schemaStatus():Promise<{ready:boolean;requiredVersion:3}>{
      return db.transaction(async tx=>{
        const [row]=await tx.query<{tables_ready:boolean;columns_ready:boolean;grant_many_snapshots:boolean}>(`SELECT
          to_regclass('coach_online_preference') IS NOT NULL AND to_regclass('coach_declared_source_revision') IS NOT NULL
          AND to_regclass('coach_model_budget_account') IS NOT NULL AND to_regclass('coach_model_reservation') IS NOT NULL AS tables_ready,
          (SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND
            ((table_name='coach_explanation_snapshot' AND column_name IN ('revoked_at','dependency_versions'))
             OR (table_name='coach_explanation_consent' AND column_name IN ('mode','allowed_categories','service_categories','authorization_basis'))
             OR (table_name='coach_online_preference' AND column_name IN ('subject_id','athlete_id','enabled','updated_at'))
             OR (table_name='coach_declared_source_revision' AND column_name IN ('subject_id','athlete_id','source_key','content_hash','generation','updated_at'))))=16 AS columns_ready,
          NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
            WHERE c.conrelid=to_regclass('coach_explanation_snapshot') AND c.contype='u' AND array_length(c.conkey,1)=1 AND a.attname='consent_id') AS grant_many_snapshots`);
        return {ready:!!row&&row.tables_ready&&row.columns_ready&&row.grant_many_snapshots,requiredVersion:3};
      });
    },
    async subject(id: string): Promise<VerifiedCoachSubject> {
      if (!id || id === 'dev-user' || id.length > 200) throw Error('AUTH_REQUIRED');
      return db.transaction(async tx => {
        await tx.query('INSERT INTO coach_self_athlete(athlete_id,subject_id) VALUES($1,$2) ON CONFLICT(subject_id) DO NOTHING', [randomUUID(), id]);
        const [row] = await tx.query<{ athlete_id: string }>('SELECT athlete_id FROM coach_self_athlete WHERE subject_id=$1', [id]);
        if (!row) throw Error('ATHLETE_ACCESS_REQUIRED');
        return { id, verified: true, athleteIds: [row.athlete_id] };
      });
    },
    async enableConsent(subject:VerifiedCoachSubject){
      return db.transaction(async tx=>{
        const [owner]=await tx.query<{athlete_id:string}>('SELECT athlete_id FROM coach_self_athlete WHERE subject_id=$1 FOR UPDATE',[subject.id]);
        if(!owner||!subject.athleteIds.includes(owner.athlete_id))throw Error('ATHLETE_ACCESS_REQUIRED');
        const row=await consent(tx,subject,owner.athlete_id,'PERSISTENT',true);
        return {ok:true,consentId:row.consent_id,expiresAt:iso(row.expires_at)};
      });
    },
    async disableConsent(subject:VerifiedCoachSubject){
      return db.transaction(async tx=>{
        const [owner]=await tx.query<{athlete_id:string}>('SELECT athlete_id FROM coach_self_athlete WHERE subject_id=$1 FOR UPDATE',[subject.id]);
        if(!owner||!subject.athleteIds.includes(owner.athlete_id))throw Error('ATHLETE_ACCESS_REQUIRED');
        const time=new Date(now()).toISOString();
        await tx.query(`INSERT INTO coach_online_preference(subject_id,athlete_id,enabled,updated_at) VALUES($1,$2,false,$3) ON CONFLICT(subject_id,athlete_id) DO UPDATE SET enabled=false,updated_at=EXCLUDED.updated_at`,[subject.id,owner.athlete_id,time]);
        await tx.query(`UPDATE coach_explanation_consent SET revoked_at=COALESCE(revoked_at,$3::timestamptz) WHERE subject_id=$1 AND athlete_id=$2 AND purpose='coach_explanation'`,[subject.id,owner.athlete_id,time]);
        return {ok:true,enabled:false,consentRevoked:true};
      });
    },
    async create(subject: VerifiedCoachSubject, input: CoachSnapshotCreate): Promise<CoachSnapshotCreated> {
      const asOf=new Date(now()).toISOString(),expiresAt=new Date(now()+TTL).toISOString(),snapshotId=randomUUID();
      const rawInput=declarationCoachInput(input);
      return db.transaction(async tx=>{
        const [owner]=await tx.query<{athlete_id:string}>('SELECT athlete_id FROM coach_self_athlete WHERE subject_id=$1 FOR UPDATE',[subject.id]);
        if(!owner||!subject.athleteIds.includes(owner.athlete_id))throw Error('ATHLETE_ACCESS_REQUIRED');
        const grant=await consent(tx,subject,owner.athlete_id,input.consent.mode??'PER_REQUEST');
        // Only an actual change to a declared source advances that source's generation.
        // The generation prevents reviving an old result if an old client later resubmits old content.
        const sources=new Map<string,string>();
        for(const d of input.declarations)sources.set(`declaration:${d.recordId}:${d.metric}`,hash(d));
        for(const d of input.context?.dependencyVersions??[])sources.set(`context-dependency:${d.key}`,hash(d.revision));
        for(const r of input.context?.records??[])sources.set(`context-record:${r.recordId}`,hash(r));
        const dependencyVersions:Record<string,string>={};
        for(const [key,contentHash]of [...sources].sort(([a],[b])=>a.localeCompare(b))){
          const [row]=await tx.query<{generation:string|number}>(`INSERT INTO coach_declared_source_revision(subject_id,athlete_id,source_key,content_hash,generation,updated_at) VALUES($1,$2,$3,$4,1,$5) ON CONFLICT(subject_id,athlete_id,source_key) DO UPDATE SET content_hash=EXCLUDED.content_hash,generation=CASE WHEN coach_declared_source_revision.content_hash=EXCLUDED.content_hash THEN coach_declared_source_revision.generation ELSE coach_declared_source_revision.generation+1 END,updated_at=EXCLUDED.updated_at RETURNING generation`,[subject.id,owner.athlete_id,key,contentHash,asOf]);
          if(!row)throw Error('SOURCE_REVISION_UNAVAILABLE');dependencyVersions[key]=String(row.generation);
        }
        const sourceVersion=hash(dependencyVersions),consentId=grant.consent_id;
        const snapshot:AuthorizedCoachSnapshot={subjectId:subject.id,athleteId:owner.athlete_id,snapshotId,version:sourceVersion,asOf,latestEvidenceKnownAt:asOf,expiresAt,revokedAt:null,provenance:'USER_DECLARED',authorizationMode:input.consent.mode??'PER_REQUEST',declarations:input.declarations,...(input.context?{context:input.context}:{}),dependencyVersions,
          scope:{purpose:'coach_explanation',occurrenceIds:[]},consent:{id:consentId,subjectId:subject.id,purpose:'coach_explanation',grantedAt:iso(grant.granted_at),expiresAt:iso(grant.expires_at),revokedAt:null},rawInput};
        await tx.query(`INSERT INTO coach_explanation_snapshot(snapshot_id,subject_id,athlete_id,consent_id,source_version,question,as_of,expires_at,provenance,declarations,payload,dependency_versions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'USER_DECLARED',$9::jsonb,$10::jsonb,$11::jsonb)`,[snapshotId,subject.id,owner.athlete_id,consentId,sourceVersion,input.question,asOf,expiresAt,JSON.stringify(input.declarations),JSON.stringify(snapshot),JSON.stringify(dependencyVersions)]);
        return {ok:true,snapshotRef:{snapshotId,consentId,asOf},expiresAt,sourceVersion,provenance:'USER_DECLARED',disclosureVersion:COACH_DISCLOSURE_VERSION,factQuotes:input.declarations.map(declarationQuote),...(input.context?{contextQuotes:input.context.records.map(contextRecordQuote)}:{})};
      });
    },
    async load(subject:VerifiedCoachSubject,refs:CoachSnapshotRefs):Promise<AuthorizedCoachSnapshot|null>{
      return db.transaction(async tx=>{
        const [row]=await tx.query<{payload:AuthorizedCoachSnapshot}>(`SELECT s.payload FROM coach_explanation_snapshot s
          JOIN coach_self_athlete a ON a.athlete_id=s.athlete_id AND a.subject_id=s.subject_id
          JOIN coach_explanation_consent c ON c.consent_id=s.consent_id AND c.subject_id=s.subject_id AND c.athlete_id=s.athlete_id
          WHERE s.snapshot_id=$1 AND s.subject_id=$2 AND s.consent_id=$3 AND s.as_of=$4 AND s.question=$5
            AND s.expires_at>$6 AND s.revoked_at IS NULL AND c.expires_at>$6 AND c.revoked_at IS NULL AND c.purpose='coach_explanation'
            AND NOT EXISTS(SELECT 1 FROM coach_online_preference p WHERE p.subject_id=s.subject_id AND p.athlete_id=s.athlete_id AND p.enabled=false)
            AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(s.dependency_versions) d WHERE NOT EXISTS(SELECT 1 FROM coach_declared_source_revision r WHERE r.subject_id=s.subject_id AND r.athlete_id=s.athlete_id AND r.source_key=d.key AND r.generation::text=d.value))`,[refs.snapshotId,subject.id,refs.consentId,refs.asOf,refs.question,new Date(now()).toISOString()]);
        return row&&subject.athleteIds.includes(row.payload.athleteId)?row.payload:null;
      });
    },
    async revoke(subject:VerifiedCoachSubject,refs:CoachSnapshotReference):Promise<boolean>{
      return db.transaction(async tx=>{
        const rows=await tx.query(`UPDATE coach_explanation_snapshot s SET revoked_at=COALESCE(s.revoked_at,$5::timestamptz) FROM coach_self_athlete a WHERE s.snapshot_id=$1 AND s.subject_id=$2 AND s.consent_id=$3 AND s.as_of=$4 AND a.athlete_id=s.athlete_id AND a.subject_id=$2 RETURNING s.snapshot_id`,[refs.snapshotId,subject.id,refs.consentId,refs.asOf,new Date(now()).toISOString()]);
        return rows.length>0;
      });
    },
    async revokeConsent(subject:VerifiedCoachSubject,consentId:string):Promise<boolean>{
      return db.transaction(async tx=>{
        const time=new Date(now()).toISOString();
        const rows=await tx.query<{athlete_id:string;mode:string}>(`UPDATE coach_explanation_consent c SET revoked_at=COALESCE(c.revoked_at,$3::timestamptz) FROM coach_self_athlete a WHERE c.consent_id=$1 AND c.subject_id=$2 AND a.athlete_id=c.athlete_id AND a.subject_id=$2 RETURNING c.consent_id,c.athlete_id,c.mode`,[consentId,subject.id,time]);
        if(rows[0]?.mode==='PERSISTENT')await tx.query(`INSERT INTO coach_online_preference(subject_id,athlete_id,enabled,updated_at) VALUES($1,$2,false,$3) ON CONFLICT(subject_id,athlete_id) DO UPDATE SET enabled=false,updated_at=EXCLUDED.updated_at`,[subject.id,rows[0].athlete_id,time]);
        return rows.length>0;
      });
    },
  };
}
