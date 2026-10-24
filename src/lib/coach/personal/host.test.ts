import test from "node:test";
import assert from "node:assert/strict";
import { setEventContext } from "@/lib/core/events";
import { changePersonal, personalAnswer, defaultPersonalProfile, personalStore } from "./host";
const memory = new Map<string, string>();
const storage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => {
    memory.set(k, v);
  },
};
function environment() {
  memory.clear();
  setEventContext({ athleteId: "personal-test-a" });
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage, dispatchEvent: () => {} },
    configurable: true,
  });
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let queue = Promise.resolve();
  Object.defineProperty(globalThis, "navigator", {
    value: {
      locks: {
        request: (_key: string, fn: () => unknown) => {
          const p = queue.then(fn);
          queue = p.then(
            () => {},
            () => {},
          );
          return p;
        },
      },
    },
    configurable: true,
  });
  return () => {
    delete (globalThis as { window?: unknown }).window;
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
    setEventContext({ athleteId: "local" });
  };
}
test("browser writes are locked; two stale writers cannot overwrite profile", async () => {
  const cleanup = environment();
  try {
    const p = defaultPersonalProfile("personal-test-a");
    const results = await Promise.allSettled([
      changePersonal((s) => s.saveProfile(p)),
      changePersonal((s) => s.saveProfile(p)),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(personalStore().read().profile?.revision, 1);
  } finally {
    cleanup();
  }
});
test("chat uses adopted version and athlete scope, does not invent diet history or ignore pain", async () => {
  const cleanup = environment();
  try {
    await changePersonal((s) => {
      s.saveProfile({
        ...defaultPersonalProfile("personal-test-a"),
        age: 30,
        screen: "CLEAR",
        days: [1, 4],
        services: ["STRENGTH"],
      });
      const p = s.prepare()!;
      s.confirm(p.token, "CONFIRM_PERSONAL_PLAN");
    });
    assert.match(personalAnswer("我的力量方案", new Date().toISOString())!, /已采用/);
    assert.equal(personalAnswer("昨天力量记录", new Date().toISOString()), null);
    await changePersonal((s) =>
      s.feedback({
        planVersion: 1,
        pain: true,
        completedSessions: 1,
        effort: "HARD",
        adherenceDays: 1,
        weightTrend: "UNKNOWN",
        completeWeightWindows: false,
      }),
    );
    assert.match(personalAnswer("我的力量方案", new Date().toISOString())!, /暂停/);
    setEventContext({ athleteId: "personal-test-b" });
    // Without confirmed conditions the athlete still gets a general, clearly unconfirmed draft;
    // numbers that depend on the missing health screening are withheld.
    const draft = personalAnswer("我的力量方案", new Date().toISOString())!;
    assert.match(draft, /尚未在“私人教练”里确认条件/);
    assert.match(draft, /需补齐健康筛查/);
    assert.doesNotMatch(draft, /d+s*(千卡|kcal)/);
  } finally {
    cleanup();
  }
});
test("no lock support means zero unlocked mutations", async () => {
  const cleanup = environment();
  try {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    await assert.rejects(
      changePersonal((s) => s.saveProfile(defaultPersonalProfile("personal-test-a"))),
    );
    assert.equal(memory.size, 0);
  } finally {
    cleanup();
  }
});
