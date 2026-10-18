export type CoachInputSummary = {
  version: 'FK-R12-INPUT-SUMMARY-1'; bytes: number; asOf: string | null
  personalSources: string[]; memoryCount: number; teachingCandidates: number; pendingResearch: number
  evidenceOmitted: boolean; independentlyVerifiedKnowledgeThisRun: 0
}
/** Parse the exact redacted request message. The UI never independently recomputes its numbers. */
export function summarizeCoachInput(message: string): CoachInputSummary {
  const data = JSON.parse(message)
  const ids = new Set<string>()
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    for (const [key, item] of Object.entries(value)) {
      if (['sourceIds', 'cites', 'citations'].includes(key) && Array.isArray(item)) {
        for (const id of item) if (typeof id === 'string') ids.add(id)
      } else if (key === 'sourceId' && typeof item === 'string') ids.add(item)
      if (key === 'evidenceContext' && typeof item === 'string') {
        try { visit(JSON.parse(item)) } catch { /* Non-JSON context carries no structured source IDs. */ }
      }
      if (key !== 'knowledgeContext' && key !== 'coachPlaybook' && key !== 'coachContextMemory') visit(item)
    }
  }
  visit(data.personalEvidenceV4 ?? {})
  // Non-V4 routes retain their original bound sources; source metadata is not itself evidence.
  if (!data.personalEvidenceV4) visit(data)
  return { version: 'FK-R12-INPUT-SUMMARY-1', bytes: new TextEncoder().encode(message).length,
    asOf: typeof data.personalEvidenceV4?.asOf === 'string' ? data.personalEvidenceV4.asOf : null,
    personalSources: [...ids].sort(), memoryCount: Array.isArray(data.coachContextMemory) ? data.coachContextMemory.length : 0,
    teachingCandidates: data.knowledgeContext?.lessons?.length ?? 0, pendingResearch: data.knowledgeContext?.pendingResearch?.length ?? 0,
    evidenceOmitted: data.personalEvidenceV4?.status === 'BUDGET_EXCEEDED' || Number(data.personalEvidenceV4?.unknownCommitTimeRecords) > 0 || Number(data.integrationAudit?.omittedFacts) > 0 || Number(data.integrationAudit?.droppedRows) > 0,
    independentlyVerifiedKnowledgeThisRun: 0 }
}
