import { spawn } from "node:child_process";
import { openSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(import.meta.url),
  { chromium } = require("playwright"),
  root = process.cwd(),
  out = process.env.R8_SCREENSHOT_DIR ?? "/workspace/screenshots/r8",
  artifacts = process.env.R8_ARTIFACT_DIR ?? resolve(root, "..");
mkdirSync(artifacts, { recursive: true });
mkdirSync(out, { recursive: true });
const server = spawn("npm", ["run", "dev"], {
  cwd: root,
  env: process.env,
  stdio: ["ignore", openSync(resolve(artifacts, "r8-browser-server.log"), "w"), "ignore"],
});
let browser;
const cases = [],
  errors = [],
  modelRequests = [],
  screenshots = [];
try {
  for (let i = 0; i < 180; i++) {
    try {
      if ((await fetch("http://127.0.0.1:8080/")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--single-process", "--no-zygote"],
    env: { ...process.env, FONTCONFIG_PATH: "/etc/fonts" },
  });
  const context = await browser.newContext({
    viewport: { width: 430, height: 1000 },
    serviceWorkers: "block",
    timezoneId: "Asia/Shanghai",
  });
  await context.route("**/api/**", (r) => {
    if (/coach/.test(r.request().url())) modelRequests.push(r.request().url());
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ connected: false, status: "not_connected" }),
    });
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-10-25T10:00:00Z"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: "先逛逛", exact: true }).click({ timeout: 60000 });
  await page.evaluate(async () => {
    const { emptyProfile, saveProfile } = await import("/src/lib/strength/profile.ts");
    saveProfile({
      ...emptyProfile(),
      age: "30",
      sex: "male",
      heightCm: "178",
      weightKg: "66",
      aim: "keep",
      minutes: 60,
      days: 5,
      trainingDays: [1, 2, 3, 5, 6],
      equipment: "NONE",
    });
    const { setOnline } = await import("/src/lib/coach/online-coach.ts");
    setOnline(false);
    const { appendSymptom } = await import("/src/lib/health/symptom-store.ts");
    appendSymptom({
      kind: "PAIN",
      region: "膝",
      side: "LEFT",
      severity: 0,
      durationHours: 0,
      trigger: null,
      functionImpact: "NORMAL",
      trend: "STABLE",
      notes: "合成当前反馈",
      trainingRefs: [],
      occurredAt: new Date().toISOString(),
    });
    const { createTrainingImportDraft, confirmTrainingImport } =
      await import("/src/lib/core/training-import.ts");
    const f = (value) => ({ value, status: "RECORDED", sourceIds: ["user-edited"] });
    for (const day of ["12", "14", "16", "19", "21", "23"]) {
      const d = createTrainingImportDraft(
        {
          sport: "RUNNING",
          title: f("实际轻松跑"),
          occurredAt: f(`2026-10-${day}T08:00:00Z`),
          durationSeconds: f(1200),
          observedRunType: f("EASY"),
          runningStructure: "CONTINUOUS",
          sessionRpe: f(5),
          comparisonContext: {
            deviceId: f("strap-A"),
            protocolKey: f("easy-3km"),
            surface: f("track"),
            gradePercent: f(0),
          },
          runningSegments: [
            {
              id: "s1",
              kind: "CONTINUOUS",
              round: f(1),
              repeat: f(1),
              distanceMeters: f(3000),
              durationSeconds: f(1200),
              recoverySeconds: f(0),
              averageHeartRateBpm: f(150),
              heartRateMethod: f("CHEST_STRAP"),
              completion: "COMPLETED",
              sourceIds: ["user-edited"],
            },
          ],
        },
        "TEXT",
        ["user-edited"],
      );
      if (!confirmTrainingImport(d).ok) throw Error("run confirm failed");
    }
    for (const day of ["13", "17", "20", "24"]) {
      const d = createTrainingImportDraft(
        {
          sport: "STRENGTH",
          title: f("实际臀桥课"),
          occurredAt: f(`2026-10-${day}T08:00:00Z`),
          durationSeconds: f(1200),
          comparisonContext: { protocolKey: f("bridge-v1") },
          strengthSets: [1, 2, 3].map((i) => ({
            id: "set" + i,
            exerciseName: f("臀桥"),
            setOrdinal: f(i),
            weightKg: f(0),
            repetitions: f(10),
            loadBasis: f("BODYWEIGHT"),
            side: f("BILATERAL"),
            rir: f(3),
            rangeProtocol: f("full"),
            completion: "COMPLETED",
          })),
        },
        "TEXT",
        ["user-edited"],
      );
      if (!confirmTrainingImport(d).ok) throw Error("strength confirm failed");
    }
  });
  const state = () =>
    page.evaluate(async () => {
      const { loadSchedule } = await import("/src/lib/ui/day-schedule.ts");
      const { readCycleGoal, readCycleDocuments } = await import("/src/lib/coach/cycle/host.ts");
      return { goal: readCycleGoal(), docs: readCycleDocuments(), entries: loadSchedule().entries };
    });
  const shot = async (name, loc) => {
    const path = out + "/" + name + ".png";
    if (loc) {
      await loc.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
      await page.waitForTimeout(200);
    }
    await page.screenshot({ path, fullPage: false });
    screenshots.push(path);
  };
  await page.getByRole("button", { name: "切换到方坤", exact: true }).click();
  await page.getByRole("button", { name: "复盘", exact: true }).click();
  const panel = page.getByTestId("r6-cycle");
  await panel.waitFor();
  await panel.getByLabel("周期项目距离", { exact: true }).fill("800");
  await panel.getByLabel("周期训练经历", { exact: true }).selectOption("TRAINED");
  await panel.getByRole("button", { name: "确认保存周期目标", exact: true }).click();
  await panel.getByRole("button", { name: "按近两周生成四周草案", exact: true }).click();
  await page.waitForTimeout(300);
  let s = await state(),
    d = s.docs[0].draft;
  if (s.entries.length || d.weeks.length !== 4)
    throw Error("draft changed schedule or incorrect horizon");
  for (const w of d.weeks) {
    const cs = w.sessions.flatMap((x) => (x.candidate ? [x.candidate] : []));
    if (!cs.some((c) => c.modality === "run") || !cs.some((c) => c.modality === "strength"))
      throw Error("missing run/strength: " + JSON.stringify(w));
  }
  cases.push({
    name: "ten confirmed actual imports create four-week run/strength draft without writing calendar",
    weeks: 4,
    firstWeek: d.weeks[0].sessions.filter((s) => s.candidate).length,
  });
  await panel.locator("summary").filter({ hasText: "当前能力画像与来源" }).click();
  await shot("01-portrait", panel.getByTestId("r8-adaptive"));
  await shot("02-confirm-card", panel.getByTestId("r6-cycle-draft").locator("details").first());
  await shot(
    "08-confirm-controls",
    panel.getByRole("button", { name: "确认最近一周", exact: true }),
  );
  await panel.getByRole("button", { name: "确认最近一周", exact: true }).click();
  await page.waitForTimeout(200);
  s = await state();
  if (s.entries.length !== 5) throw Error("confirmation failed: " + JSON.stringify(s.docs[0]));
  cases.push({ name: "confirmation writes only five first-week courses", count: s.entries.length });
  await panel.getByRole("button", { name: "撤销最近一周", exact: true }).click();
  await page.waitForTimeout(200);
  if ((await state()).entries.length) throw Error("undo failed");
  cases.push({ name: "undo restores empty future calendar; actual imports retained" });
  await page.evaluate(async () => {
    const { readAnalysis } = await import("/src/lib/health/analysis-host.ts"),
      { savePersonalResponse } = await import("/src/lib/health/personal-response-store.ts");
    const a = readAnalysis();
    for (const t of a.snapshot.facts.filter(
      (t) =>
        t.kind === "TRAINING" && t.modality === "STRENGTH" && /2026-10-(17|24)/.test(t.startedAt),
    )) {
      const at = new Date(Date.parse(t.endedAt) + 24 * 36e5).toISOString(),
        id = t.id + ":sore";
      const r = savePersonalResponse({
        ...t,
        id,
        sourceRecordId: id,
        revision: 0,
        provider: "MANUAL",
        kind: "RESPONSE",
        occurredAt: at,
        knownAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        relatedTrainingRefs: [{ id: t.id, revision: t.revision }],
        region: "glutes",
        side: "BILATERAL",
        measure: "SORENESS",
        value: 4,
        scale: "0-10_HIGH_WORSE",
        observationProtocol: "SELF_REPORTED_SORENESS_ZERO_V1",
        elapsedHours: 24,
        functionTaskId: null,
        notes: null,
      });
      if (!r.ok) throw Error(r.error);
    }
  });
  await panel.getByRole("button", { name: "按近两周生成四周草案", exact: true }).click();
  await page.waitForTimeout(200);
  d = (await state()).docs[0].draft;
  const strengths = d.weeks[0].sessions.flatMap((s) =>
    s.candidate?.modality === "strength" ? [s.candidate] : [],
  );
  if (!strengths.length || strengths.some((s) => s.exercises[0].sets !== "2"))
    throw Error("linked feedback did not reduce proposal");
  await shot(
    "03-feedback-revision",
    panel.getByTestId("r6-cycle-draft").locator("details").first(),
  );
  cases.push({
    name: "two linked soreness observations revise strength from three sets to two",
    sets: strengths.map((s) => s.exercises[0].sets),
  });
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await page
    .getByLabel("输入你的问题", { exact: true })
    .fill("根据我这两周的训练出后面一个月的训练计划，包括力量周期和跑步安排");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForTimeout(600);
  if (!(await page.getByTestId("coach-messages").innerText()).includes("4周周期草案"))
    throw Error("month chat intent failed");
  await shot("04-chat");
  cases.push({ name: "natural-language month request produces offline confirmed-facts draft" });
  await page.getByRole("button", { name: "复盘", exact: true }).click();
  await page.evaluate(async () => {
    const { appendSymptom } = await import("/src/lib/health/symptom-store.ts");
    appendSymptom({
      kind: "PAIN",
      region: "膝",
      side: "LEFT",
      severity: 6,
      durationHours: 24,
      trigger: "跑步",
      functionImpact: "LIMITED",
      trend: "WORSENING",
      notes: "合成安全反证",
      trainingRefs: [],
      occurredAt: new Date().toISOString(),
    });
  });
  await panel.getByRole("button", { name: "按近两周生成四周草案", exact: true }).click();
  await page.waitForTimeout(200);
  d = (await state()).docs[0].draft;
  if (!d.hold || d.weeks[0].canConfirm) throw Error("pain not prioritized");
  await shot("05-pain-hold", panel.getByTestId("r6-cycle-draft").locator("details").first());
  cases.push({ name: "pain overrides earlier tolerated dose and blocks confirmation" });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
    throw Error("mobile overflow");
  await shot("06-mobile", panel.getByTestId("r6-cycle-draft"));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await shot("07-desktop", panel.getByTestId("r6-cycle-draft"));
  writeFileSync(
    resolve(artifacts, "r8-browser.json"),
    JSON.stringify({ cases, errors, modelRequests, screenshots, synthetic: true }, null, 2),
  );
  console.log(
    JSON.stringify({ cases: cases.length, errors, modelRequests, screenshots: screenshots.length }),
  );
  if (errors.length || modelRequests.length) process.exitCode = 1;
} catch (e) {
  writeFileSync(
    resolve(artifacts, "r8-browser.json"),
    JSON.stringify({ cases, errors, modelRequests, screenshots, error: e.stack }, null, 2),
  );
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
