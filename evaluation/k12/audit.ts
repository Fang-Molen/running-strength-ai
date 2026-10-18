/** Post-hoc: run the product's offline research audit (keyword screen) on real raw answers. Criteria are read only here, after answers exist. */
import { readFileSync, writeFileSync } from "node:fs"
import { auditResearchReasoning } from "@/lib/core/research-reasoning-audit"
const [rawPath, critPath, outPath] = process.argv.slice(2)
const crit = JSON.parse(readFileSync(critPath, "utf8"))
const rows = readFileSync(rawPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
const out: unknown[] = []
for (const r of rows) {
  const c = crit[r.case_id]; if (!c) continue
  let text: string | undefined
  try { const raw = r.raw_response as string; const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); text = `${j.text} ${j.nextStep ?? ""}` } catch { text = r.raw_response ?? undefined }
  const a = auditResearchReasoning({ id: r.case_id, question: r.question, ...c.audit }, text)
  out.push({ case_id: r.case_id, batch: r.batch, accepted: a.accepted, sourceRoutingPass: a.sourceRoutingPass, conflictRoutingPass: a.conflictRoutingPass, cautions: a.answerCautionsPass, forbidden: a.answerForbiddenClaimsPass, uncertainty: a.answerUncertaintyPass, discourse: a.discourseReviewReasons, negated: a.negatedClaimTerms })
}
writeFileSync(outPath, JSON.stringify(out, null, 1))
for (const o of out as { case_id: string; accepted: boolean; sourceRoutingPass: boolean; cautions: boolean; forbidden: boolean; uncertainty: boolean; discourse: string[] }[]) console.log(o.case_id, "accepted", o.accepted, "route", o.sourceRoutingPass, "caut", o.cautions, "forb", o.forbidden, "unc", o.uncertainty, o.discourse.join(","))
