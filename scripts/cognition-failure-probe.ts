/** Synthetic stale-write interleaving on the real event-store API. No user storage. */
import { writeFileSync } from "node:fs";
import { setStoreBackend } from "../src/lib/core/storage.ts";
import { dispatchEvent, loadEvents, EVENT_JOURNAL_PREFIX } from "../src/lib/core/events.ts";
const data = new Map<string, string>();
let injected = false;
let secondId: string | null = null;
setStoreBackend({
  keys: () => [...data.keys()],
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => {
    // Writer B commits after A's read and before A's physical-record commit.
    if (key.startsWith(EVENT_JOURNAL_PREFIX) && !injected) {
      injected = true;
      secondId = dispatchEvent("TRAINING_STARTED", { probe: "B" })?.event_id ?? null;
    }
    data.set(key, value);
  },
});
const first = dispatchEvent("TRAINING_STARTED", { probe: "A" });
const retained = loadEvents().map((e) => e.event_id);
const result = {
  id: "EVENT_STALE_WRITE",
  scope: "SYNTHETIC_INTERLEAVING_REAL_STORAGE_API_NOT_BROWSER",
  status: secondId && retained.includes(secondId) ? "PASS" : "FAIL",
  returnedSuccess: { A: !!first, B: !!secondId },
  retainedCount: retained.length,
  lostWrite: secondId != null && !retained.includes(secondId),
  severity: "P0",
  reason:
    "independent immutable physical keys retain both overlapping commits; real browser cross-tab verification is separate",
};
setStoreBackend(null);
const output = process.argv[2];
if (!output) throw new Error("Usage: cognition-failure-probe.ts output.json");
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
process.exitCode = result.status === "FAIL" ? 1 : 0;
