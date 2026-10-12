import { readFileSync } from "node:fs"
import { deriveCoachBrief } from "@/lib/core/coach-brief"
import { buildCoachModelRequest, normalizeAskCoachInput } from "@/lib/strength/coach-pipeline"
import { buildParts } from "./fixtures.ts"
const scenarios = JSON.parse(readFileSync(process.argv[2], "utf8"))
const criteria = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : {}
for (const s of scenarios) {
  const data = normalizeAskCoachInput({ brief: deriveCoachBrief(buildParts(s.question, s.facts)), history: s.history ?? [] })
  const r = buildCoachModelRequest(data)
  const text = JSON.stringify(r.messages)
  const c = criteria[s.id]; const leaks = c ? [...c.must, ...c.must_not, c.trap ?? ""].filter((x: string) => x && x.length > 6 && text.includes(x)) : []; if (leaks.length) console.log("LEAKED:", leaks)
  console.log(s.id, r.kind, r.intent, "maxTok", r.maxTokens, "chars", text.length, "mustAsk", data.brief.mustAsk.join("|") || "-", "next", data.brief.nextSession?.status, data.brief.nextSession?.allowed.join("/"), "ret", data.brief.returnToTraining?.state, "rag", JSON.stringify({ l: r.knowledgeContext.lessons.map((x) => x.id), e: r.knowledgeContext.researchEvidence.entries.map((x) => x.id), c: r.knowledgeContext.conflictReviews.entries.map((x: { id: string }) => x.id) }), leaks.length ? "LEAK!" : "")
}
