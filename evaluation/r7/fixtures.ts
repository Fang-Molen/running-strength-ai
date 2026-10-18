import { row } from "../r6/fixtures.ts";
export const fullRows = () => [
  ...[195.41, 192.73, 191, 182.76].map((n, i) =>
    row(`work${i + 1}`, "SPLIT_SECONDS", n, {
      protocol: `running:c:rep:b:step:1:${i + 1}:990m`,
      occurredAt: `2026-03-01T10:${String(i * 6).padStart(2, "0")}:00Z`,
    }),
  ),
  ...[1, 2, 3].map((i) =>
    row(`rest${i}`, "REST_SECONDS", 210, {
      protocol: `running:c:rest:b:AFTER_REPEAT:step:1:${i}`,
      occurredAt: `2026-03-01T10:${String(i * 6 - 2).padStart(2, "0")}:00Z`,
    }),
  ),
  row("ev:s1:rpe", "SESSION_RPE", 6),
  row("sleep", "SLEEP_HOURS", 7),
  row("pain", "PAIN_SCORE", 0),
];
