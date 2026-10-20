import { ensure, epoch, nonempty, stable, validRange, validateWindow, overlaps, READ_ONLY, type MinuteRange, type Window } from './common.ts';
export type RestKind = 'MAIN_SLEEP' | 'NAP' | 'SLEEP_UNCLASSIFIED' | 'QUIET_REST' | 'IN_BED' | 'AWAKE' | 'REST_UNCERTAIN';
export type RestRecord = Readonly<{
  athleteId: string; sourceNamespace: string; originEventId: string | null; transport: string; transportRecordId: string;
  revision: number; knownAt: number; occurredStart: number | null; occurredEnd: number | null; removed: boolean;
  kind: RestKind; form: 'INTERVAL' | 'DURATION_ESTIMATE' | 'SESSION_TOTAL' | 'DAY_TOTAL';
  /** Only INTERVAL describes actual sleep/rest, never inferred from a timer or an in-bed span. */
  duration: MinuteRange | null; contextDay: string | null; sourceEpisodeId: string | null;
  inclusion: 'MAIN_ONLY' | 'INCLUDES_NAPS' | 'UNKNOWN' | 'NOT_APPLICABLE'; protocol: string;
}>;
export type RestSelection = { records: RestRecord[]; keys: string[]; conflicts: string[]; excluded: { key: string; reason: string }[] };
const kinds: RestKind[] = ['MAIN_SLEEP','NAP','SLEEP_UNCLASSIFIED','QUIET_REST','IN_BED','AWAKE','REST_UNCERTAIN'];
export const restKey = (r: RestRecord): string => stable([r.athleteId, r.sourceNamespace,
  r.originEventId === null ? ['UNRESOLVED_ORIGIN', r.transport, r.transportRecordId] : ['ORIGIN', r.originEventId]]);
function validateRecord(r: RestRecord): void {
  ensure(nonempty(r.athleteId) && nonempty(r.sourceNamespace) && nonempty(r.transport) && nonempty(r.transportRecordId) &&
    (r.originEventId === null || nonempty(r.originEventId)) && (r.sourceEpisodeId === null || nonempty(r.sourceEpisodeId)), 'BAD_REST_ID');
  ensure(Number.isSafeInteger(r.revision) && r.revision > 0 && epoch(r.knownAt) && typeof r.removed === 'boolean', 'BAD_REST_REVISION');
  ensure(kinds.includes(r.kind) && ['INTERVAL','DURATION_ESTIMATE','SESSION_TOTAL','DAY_TOTAL'].includes(r.form) &&
    ['MAIN_ONLY','INCLUDES_NAPS','UNKNOWN','NOT_APPLICABLE'].includes(r.inclusion) && nonempty(r.protocol), 'BAD_REST_ENUM');
  ensure((r.occurredStart === null || epoch(r.occurredStart)) && (r.occurredEnd === null || epoch(r.occurredEnd)), 'BAD_REST_TIME');
  ensure(r.occurredEnd === null || r.occurredStart !== null && r.occurredEnd > r.occurredStart, 'BAD_REST_INTERVAL');
  ensure(r.duration === null || validRange(r.duration), 'BAD_DURATION_RANGE');
  ensure(r.contextDay === null || /^\d{4}-\d{2}-\d{2}$/.test(r.contextDay) && Number.isFinite(Date.parse(r.contextDay)) &&
    new Date(r.contextDay).toISOString().slice(0,10) === r.contextDay, 'BAD_CONTEXT_DAY');
  if (!r.removed && r.form === 'INTERVAL') ensure(r.occurredStart !== null, 'INTERVAL_START_REQUIRED');
  if (!r.removed && r.form !== 'INTERVAL') ensure(r.duration !== null, 'SUMMARY_DURATION_REQUIRED');
}
function body(r: RestRecord): string {
  const { knownAt: _k, transport: _t, transportRecordId: _i, ...data } = r;
  return stable(data);
}
/** Explicit revisions first, then temporal filtering. No last-write-wins between unrelated origins. */
export function selectRestRecords(input: readonly RestRecord[], athleteId: string, asOf: number): RestSelection {
  ensure(nonempty(athleteId) && epoch(asOf) && input.length <= 20000, 'BAD_REST_CONTEXT');
  const groups = new Map<string, RestRecord[]>(), excluded: RestSelection['excluded'] = [], conflicts: string[] = [];
  for (const r of input) {
    if (r.athleteId !== athleteId) continue;
    validateRecord(r);
    if (r.knownAt > asOf) continue;
    const key = restKey(r); groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const records: RestRecord[] = [];
  for (const [key, rows] of groups) {
    const max = Math.max(...rows.map(x => x.revision)), latest = rows.filter(x => x.revision === max);
    if (new Set(latest.map(body)).size !== 1) { conflicts.push(key); continue; }
    const selected = [...latest].sort((a,b) => a.knownAt - b.knownAt || a.transport.localeCompare(b.transport))[0];
    if (selected.removed) { excluded.push({ key, reason: 'REMOVED' }); continue; }
    if (selected.form === 'INTERVAL' && selected.occurredEnd === null) { excluded.push({ key, reason: 'ONGOING_OR_END_UNKNOWN' }); continue; }
    if ((selected.occurredStart !== null && selected.occurredStart > selected.knownAt) ||
        selected.occurredEnd !== null && (selected.occurredEnd > asOf || selected.knownAt < selected.occurredEnd)) {
      excluded.push({ key, reason: 'FUTURE_OR_INCONSISTENT_EVENT' }); continue;
    }
    records.push({ ...selected, duration: selected.duration ? { ...selected.duration } : null });
  }
  records.sort((a,b) => restKey(a).localeCompare(restKey(b)));
  return { records, keys: records.map(restKey), conflicts: conflicts.sort(), excluded };
}
function mergeIntervals(input: Window[]): Window[] {
  const rows = input.map(r => ({...r})).sort((a,b) => a.start-b.start || a.end-b.end), out: Window[] = [];
  for (const r of rows) { const last = out.at(-1); if (last && r.start <= last.end) out[out.length-1] = {start:last.start,end:Math.max(last.end,r.end)}; else out.push(r); }
  return out;
}
const sleeping = (r: RestRecord) => ['MAIN_SLEEP','NAP','SLEEP_UNCLASSIFIED'].includes(r.kind);
/** Time windows must already be resolved from the user's event timezone/shift by the host.
 * The result is observed interval coverage, not total sleep unless the host establishes coverage.
 */
export function summarizeRest(input: readonly RestRecord[], athleteId: string, asOf: number, window: Window) {
  validateWindow(window);
  const selected = selectRestRecords(input, athleteId, asOf);
  const inWindow = selected.records.filter(r => r.occurredStart === null || r.occurredEnd === null || overlaps({start:r.occurredStart,end:r.occurredEnd},window));
  const intervals = inWindow.filter(r => sleeping(r) && r.form === 'INTERVAL' && r.occurredStart !== null && r.occurredEnd !== null);
  const clips = intervals.map(r => ({r, w:{start:Math.max(r.occurredStart!,window.start),end:Math.min(r.occurredEnd!,window.end)}}));
  const overlapConflicts: string[][] = [];
  for (let i=0;i<clips.length;i++) for (let j=i+1;j<clips.length;j++) {
    const a=clips[i], b=clips[j]; if (!overlaps(a.w,b.w)) continue;
    const sameEpisode = a.r.originEventId !== null && b.r.originEventId !== null && a.r.sourceNamespace === b.r.sourceNamespace && a.r.sourceEpisodeId !== null && a.r.sourceEpisodeId === b.r.sourceEpisodeId &&
      a.r.protocol === b.r.protocol && a.r.kind === b.r.kind;
    if (!sameEpisode) overlapConflicts.push([restKey(a.r),restKey(b.r)]);
  }
  // 'Awake' is incompatible with a true asleep interval, unlike an overlapping in-bed container.
  for (const a of clips) for (const b of inWindow) {
    if (b.kind === 'AWAKE' && b.form === 'INTERVAL' && b.occurredStart !== null && b.occurredEnd !== null &&
        overlaps(a.w,{start:b.occurredStart,end:b.occurredEnd})) overlapConflicts.push([restKey(a.r),restKey(b)]);
  }
  const hasConflict = selected.conflicts.length > 0 || overlapConflicts.length > 0;
  const summaries = inWindow.filter(r => sleeping(r) && r.form !== 'INTERVAL');
  const merged = hasConflict ? [] : mergeIntervals(clips.map(x=>x.w));
  const observedMinutes = hasConflict || !merged.length ? null : merged.reduce((n,r)=>n+(r.end-r.start)/60000,0);
  // Preserve intervals/one-sided estimates in separate rows. No midpoint and no unverified sum with naps.
  const estimates = summaries.map(r => ({key:restKey(r),kind:r.kind,form:r.form,range:{...r.duration!},inclusion:r.inclusion,
    contextDay:r.contextDay,windowPlacementKnown:r.occurredStart !== null && r.occurredEnd !== null}));
  return { state:hasConflict?'CONFLICT':observedMinutes !== null?'OBSERVED_INTERVALS':estimates.length?'ESTIMATES_ONLY':'NO_OBSERVED_SLEEP',
    observedIntervalMinutes: observedMinutes, totalSleepMinutes:null, fullWindowCoverageConfirmed:false,
    intervals:merged, estimates, restOnlyKeys:inWindow.filter(r=>!sleeping(r)).map(restKey),
    records:inWindow, sourceConflicts:selected.conflicts, overlapConflicts, excluded:selected.excluded,
    notes:[...(summaries.length?['SUMMARY_OR_ESTIMATE_NOT_ADDED_TO_INTERVALS']:[]),
      ...(inWindow.some(r=>r.occurredStart===null)?['UNPLACED_DURATION_PRESERVED']:[])], ...READ_ONLY };
}
/** Only combine explicitly attested disjoint contributions; no origin matching is inferred here.
 * A caller-created receipt is NOT trusted authorization; production must obtain it from its own resolver.
 */
export function combineDisjointRanges(input: { athleteId:string; values:{key:string; range:MinuteRange}[];
  partition: {athleteId:string; memberKeys:string[]; version:string; disjoint:boolean} | null }) {
  ensure(nonempty(input.athleteId) && input.values.every(v=>nonempty(v.key)&&validRange(v.range)), 'BAD_RANGES');
  ensure(new Set(input.values.map(x=>x.key)).size === input.values.length, 'DUPLICATE_RANGE');
  const p=input.partition;
  const attested = !!p && p.athleteId===input.athleteId && nonempty(p.version) && p.disjoint===true &&
    stable([...p.memberKeys].sort())===stable(input.values.map(v=>v.key).sort()) && input.values.length>0;
  return {state:attested?'ATTESTED_RANGE_SUM':'UNAVAILABLE', range:attested?{low:input.values.reduce((n,v)=>n+v.range.low,0),
    high:input.values.some(v=>v.range.high===null)?null:input.values.reduce((n,v)=>n+v.range.high!,0)}:null, ...READ_ONLY};
}
