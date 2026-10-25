import test from "node:test";
import assert from "node:assert/strict";
import { withScheduleLock } from "../../ui/schedule-writer";
test("failed synchronous schedule callback releases the native lock for the next operation", async () => {
  await assert.rejects(
    withScheduleLock(() => {
      throw Error("synthetic version conflict");
    }),
    /synthetic version conflict/,
  );
  let clock: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([
      withScheduleLock(() => 42),
      new Promise<never>((_, reject) => {
        clock = setTimeout(() => reject(Error("LOCK_NOT_RELEASED")), 1000);
      }),
    ]);
    assert.equal(r.value, 42);
  } finally {
    clearTimeout(clock);
  }
});
