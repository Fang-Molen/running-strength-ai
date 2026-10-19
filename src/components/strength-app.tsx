import { OnlineFeaturesSettings } from "./online-features-settings";
import { onlineFeatures } from "@/lib/ui/online-features";
import { installChunkRecovery, isChunkError, recoverFromChunkError } from "@/lib/chunk-recover";
import { HomeDashboard } from "@/components/home-dashboard";
import { GarminLog } from "@/components/garmin-log";
import { lazy, Suspense } from "react";
const RunningTechniqueLibrary = lazy(() => import("@/components/running-technique-library").catch((e) => { if (isChunkError(e)) void recoverFromChunkError(); throw e; }));
const BodyLabPanel = lazy(() => import("@/components/bodylab/bodylab-panel").catch((e) => { if (isChunkError(e)) void recoverFromChunkError(); throw e; }));
import { exportFeedback } from "@/components/coach-feedback";
import { AthletePanel, BackupCenter, HealthPanel, PrivacyPanel, SettingsMenu, SyncStatusPanel, type GarminConnState, type SettingsPane } from "@/components/settings-center";
import { Plan400Cycle, Plan400TodayCard, Plan400DayHost, TempTrainingList, ensurePlan400Entry, PLAN400_GUIDED_EVT, openPlan400Day } from "@/components/plan400";
import { occurrenceVoided } from "@/lib/core/training-correction";
import { RunImportPrompt } from "@/components/plan400-parts";
import { DeviceImport } from "@/components/device-import";
import { importVault } from "@/lib/vault";
import { maybeAutoGarminSync } from "@/components/garmin-sync";
import { GarminSync } from "@/components/garmin-sync";
import { initVault } from "@/lib/vault";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CATALOG, GROUPS, type ExerciseGroup } from "@/lib/strength/catalog";
import { bootCore, captureOriginalPlan, dispatchEvent } from "@/lib/core";
import { loadEvents, onAppEvent } from "@/lib/core/events";
import { offlinePrefetchUrls, serviceWorkerNavigationPlan, trainingExecutionOpen } from "@/lib/ui/sw-reload";
import { CoachSheet } from "@/components/coach-sheet";
import { CoachCoordinationHub } from "@/components/coach-coordination-hub";
import {applyStrengthReduction,rollbackStrengthReduction,type StrengthProposal,type StrengthControl} from "@/lib/core/coach-strength-plan-control";
import {commitControlledStrengthPlan} from "@/lib/core/coach-strength-plan-storage";
import type {CoachStrengthAction} from "@/components/coach-strength-edit-panel";
import { BodyCenter, type BodyPane } from "@/components/body-center";
import { readWallpaper, writeWallpaper, WALLPAPERS, type WallpaperId, readDisplayMode, writeDisplayMode, type DisplayMode } from "@/lib/ui/appearance";
import { TrainingLogPage } from "@/components/training-log-v76";
import { TrainingEvidencePanel } from "@/components/training-evidence-panel";
import { AbilityRadarCard } from "@/components/ability-radar-card";
import { Activity, CalendarDays, ChevronDown, ChevronUp, ClipboardList, Database, Dumbbell, Heart, House, Footprints, MessageCircle, Palette, Plus, Scale, Settings, Target, Trash2, UserRound, Utensils, Watch, X } from "lucide-react";
import { DayCard } from "@/components/day-card";
import { TodayBoard } from "@/components/today-board";
import { PlanSourceCard } from "@/components/plan-source";
import { DietPage } from "@/components/fuel-guide";
import { ReviewPanel } from "@/components/review-card";
import { HealthLinkSheet, HomeEditor, useLocalReminders, HomeHeader, LogMetricsPanel, Onboarding, QuickLog, SettingsHub } from "@/components/r8";
import { ONBOARD_KEY } from "@/lib/ui/first-run";
import { LAYOUT_DEFAULT, loadLayout, type Layout, type QuickId } from "@/lib/ui/home-layout";
import { readLaunchParams } from "@/lib/ui/shortcut-link";
import { OVERRIDE_KEY, type Override } from "@/lib/ui/day-override";
import { loadSettings } from "@/lib/ui/app-settings";
const localDayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
import { AssessmentPanel } from "@/components/assessment-panel";
import { TrackSessionPanel } from "@/components/track-session";
import { TrainingDecisionCard } from "@/components/training-decision-card";
import { SessionOverview } from "@/components/session-overview";
import { TrainingImportSheet } from "@/components/training-import-sheet";
import { CoachPlanSheet } from "@/components/coach-plan-sheet";
import { FangShen } from "@/components/fang-shen";
import { ExerciseContent } from "@/components/exercise-content";
import { SessionBuilder } from "@/components/session-builder";
import { MuscleExplorerSheet } from "@/components/muscle-explorer";
import { DemoSheet } from "@/components/exercise-editor";
import { TrainingEditorSheet } from "@/components/training-editor-sheet";
import { SchedulePicker, ScheduledTraining } from "@/components/scheduled-training";
import { MuscleActionList } from "@/components/muscle-action-list";
import { loadSchedule, saveScheduledEntry, strengthEntry, runEntry } from "@/lib/ui/day-schedule";
import { syncScheduleProgress } from "@/lib/ui/schedule-progress";
import { scheduleExecutionId, scheduledChoices } from "@/lib/ui/scheduled-execution";
import type { ScheduleEntry } from "@/lib/ui/day-schedule-rules";
import { listTrainingOccurrences } from "@/lib/core/occurrence";
import { Sheet as AppSheet } from "@/components/sheet";
import type { MuscleAction } from "@/lib/body/muscle-actions";
import { PLAN_KEY, appendSessionCompared, savePlanCompared } from "@/lib/strength/session-builder";
import { executionOf } from "@/lib/core/execution";
import { ProfileSheet } from "@/components/profile-sheet";
import { listTrackPlans, openTrackOccurrence } from "@/lib/ui/running-workouts";
import { trackHomeView } from "@/lib/ui/running-workouts";
import { absorbFeel, loadCoach, saveCoach } from "@/lib/strength/coach";
import { emptyProfile, goalsFromProfile, loadProfile, profileFilled, profileSummary, saveProfile, withCoachGoals, type Profile } from "@/lib/strength/profile";
import { loadSupportingGoals, saveSupportingGoals } from "@/lib/ui/goal-portfolio";
import { collectLocalBackup, inspectLocalBackup, restoreLocalBackup, TRIAL_VERSION } from "@/lib/core/trial";
import { bodyTrend } from "@/lib/nutrition/body";
import { loadDay } from "@/lib/nutrition/day";
import { todayEaten } from "@/lib/nutrition/log";
import { DEFAULT_SPORT_GOAL, GOALS, SPORTS, homeVariant, loadSportGoal, saveSportGoal, type GoalId, type SportGoalPreference, type SportId } from "@/lib/ui/sport-goal";
import {
  PHASES,
  TEMPLATES,
  advanceCycle,
  blankPlan,
  customMove,
  displayName,
  ensureCycle,
  estimateMinutes,
  loadPlan,
  logSession,
  moveFromCatalog,
  phaseOf,
  savePlan,
  uid,
  weekReady,
  type Feel,
  type Move,
  type Plan,
} from "@/lib/strength/model";

const starter = ensureCycle(TEMPLATES.find((item) => item.id === "run")?.plan() ?? blankPlan());
const PLAN_SAVE_FAIL = "课表没有写入本机，原来的记录还在。可以再存一次，或打开个人与数据下载备份。"
const COACH_SAVE_FAIL = "教练记录没有写入本机，原来的记录还在。可以再存一次，或打开个人与数据下载备份。"

const FEELS: { id: Feel; label: string; hint: string }[] = [
  { id: "easy", label: "太轻松", hint: "都能做完，还能再多" },
  { id: "ok", label: "刚好", hint: "最后一两下有点吃力" },
  { id: "hard", label: "偏重", hint: "做不满，或做完腿很沉" },
  { id: "pain", label: "有不适", hint: "关节或某一下发疼，不是酸" },
  { id: "skip", label: "这周没练", hint: "这节先保持，不加减" },
];

export function StrengthApp() {
  const [bodyPane, setBodyPane] = useState<BodyPane>("recovery");
  const [, setDataRevision] = useState(0);
  useEffect(() => { try { onlineFeatures() } catch { /* storage unavailable */ } }, []); // v78 t473：联网功能默认全开，记录一次同意
  useEffect(() => {
    const refresh = () => setDataRevision(value => value + 1);
    const unsubscribe = onAppEvent(refresh);
    const onStorage = (event: StorageEvent) => { if (event.key == null || event.key.startsWith("fr255-")) refresh(); };
    window.addEventListener("storage", onStorage);
    return () => { unsubscribe(); window.removeEventListener("storage", onStorage); };
  }, []);
  const [plan, setPlan] = useState<Plan>(starter);
  const [wallpaper, setWallpaper] = useState<WallpaperId>("plain");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("light");
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    setWallpaper(readWallpaper(window.localStorage));
    setDisplayMode(readDisplayMode(window.localStorage));
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  const [active, setActive] = useState(0);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceMounted, setWorkspaceMounted] = useState(false);
  const [courseChoice, setCourseChoice] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [muscleOpen, setMuscleOpen] = useState(false), [muscleDemo, setMuscleDemo] = useState<string | null>(null);
  const [hubPane, setHubPane] = useState<"run" | "lift">("run");
  const [selectedDate, setSelectedDate] = useState(localDayIso());
  const [calendar, setCalendar] = useState<ScheduleEntry[]>([]);
  const [timerPicker, setTimerPicker] = useState(false), [executionEntryId, setExecutionEntryId] = useState<string | null>(null);
  const [actionLibrary, setActionLibrary] = useState(false);
  const [techniqueLibrary, setTechniqueLibrary] = useState(false);
  const [trainingEditor, setTrainingEditor] = useState<{ date: string; initial?: ScheduleEntry; template?: ScheduleEntry; seedAction?: MuscleAction; initialType?: "run" | "strength"; openMuscleInitially?: boolean } | null>(null);
  const planRaw = useRef<string | null>(null);
  const builderSaving=useRef(false);
  const [planConflict, setPlanConflict] = useState("");
  const [ready, setReady] = useState(false);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<ExerciseGroup | "全部">("全部");
  const [notice, setNotice] = useState("");
  const [offline, setOffline] = useState(false);
  const [offlineShellState, setOfflineShellState] = useState<"preparing" | "ready" | "unavailable">("preparing");
  const [planSaveFailed, setPlanSaveFailed] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [feel, setFeel] = useState<Feel>("ok");
  const [painIds, setPainIds] = useState<string[]>([]);
  const [feelNote, setFeelNote] = useState("");
  const [coachFocus, setCoachFocus] = useState<string | null>(null);
  const [coachLink, setCoachLink] = useState<"ask" | "bound" | "unbound">("ask");
  const [formMove, setFormMove] = useState<Move | null>(null);
  const [profile, setProfile] = useState<Profile>(emptyProfile());
  const [profileOpen, setProfileOpen] = useState(false);
  const [trainingImportOpen, setTrainingImportOpen] = useState(false);
  const [coachPlanOpen, setCoachPlanOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const prevTab = useRef<"today" | "plan" | "log" | "body" | "diet">("today");
  const [settingsPane, setSettingsPaneRaw] = useState<SettingsPane>("menu");
  const settingsScroll = useRef<HTMLDivElement>(null); const menuScrollTop = useRef(0);
  const setSettingsPane = (p: SettingsPane) => { const el = settingsScroll.current; if (p !== "menu" && el) menuScrollTop.current = el.scrollTop; setSettingsPaneRaw(p); window.setTimeout(() => { if (settingsScroll.current) settingsScroll.current.scrollTop = p === "menu" ? menuScrollTop.current : 0; }, 0); };
  const [garminConn, setGarminConn] = useState<GarminConnState>(null);
  const [weekPeek, setWeekPeek] = useState<1 | 2 | 3 | 4 | null>(null);
  const [preference, setPreference] = useState<SportGoalPreference>(DEFAULT_SPORT_GOAL);
  const [supportingGoals, setSupportingGoals] = useState<GoalId[]>([]);
  const [weightText, setWeightText] = useState<string | null>(null);
  const [runKm, setRunKm] = useState<number | null>(null);
  const [kcal, setKcal] = useState<number | null>(null);
  const [goalSaveFailed, setGoalSaveFailed] = useState(false);
  useEffect(() => { void initVault().then((r) => { if (r.restored > 0 && !sessionStorage.getItem("fk-vault-restored")) { sessionStorage.setItem("fk-vault-restored", "1"); location.reload(); } }).catch(() => {}); }, []);
  const [dietSheet, setDietSheet] = useState(false);
  useEffect(() => { const go = () => { if (document.visibilityState === "visible") window.setTimeout(() => void maybeAutoGarminSync().catch(() => {}), 1500); }; go(); document.addEventListener("visibilitychange", go); window.addEventListener("pageshow", go); window.addEventListener("online", go); const iv = window.setInterval(() => { if (document.visibilityState === "visible") void maybeAutoGarminSync().catch(() => {}); }, 2 * 3600e3 + 5000); return () => { document.removeEventListener("visibilitychange", go); window.removeEventListener("pageshow", go); window.removeEventListener("online", go); window.clearInterval(iv); }; }, []);
  const [planSrc, setPlanSrc] = useState<string>("400m-v4");
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem("fk-plan-source-v1") || "{}").active; if (v) setPlanSrc(v); } catch { /* keep default */ } }, []);
  const setPlanSrcSaved = (v: string) => { setPlanSrc(v); try { const o = JSON.parse(localStorage.getItem("fk-plan-source-v1") || "{}"); localStorage.setItem("fk-plan-source-v1", JSON.stringify({ ...o, active: v, history: [...(o.history ?? []), { active: v, at: new Date().toISOString() }] })); } catch { /* storage full */ } };
  const [tab, setTab] = useState<"today" | "plan" | "log" | "coach" | "body" | "diet">("today");
  const [homeRev, setHomeRev] = useState(0);
  const [dayOverride, setDayOverride] = useState<Override | null>(null);
  const [bandOn, setBandOn] = useState(true);
  const [firstRun, setFirstRun] = useState(false);
  const [homeLayout, setHomeLayout] = useState<Layout>(LAYOUT_DEFAULT);
  const [editHome, setEditHome] = useState(false);
  const [quickOpen, setQuickOpen] = useState<{ text: string; n: number } | null>(null);
  const [healthLink, setHealthLink] = useState<string | null>(null);
  useEffect(() => { setHomeLayout(loadLayout()); const lp = readLaunchParams(location.search); if (lp.log != null) setQuickOpen({ text: lp.log, n: Date.now() }); if (lp.health) setHealthLink(lp.health); if (lp.log != null || lp.health) history.replaceState(null, "", location.pathname); }, []);
  useEffect(() => { setFirstRun(!localStorage.getItem(ONBOARD_KEY)); setBandOn(loadSettings().band); try { const o = JSON.parse(localStorage.getItem(OVERRIDE_KEY) ?? "null"); if (o?.date === localDayIso()) setDayOverride(o) } catch { /* ignore */ } }, [tab]);
  const [planLens, setPlanLens] = useState<"all" | "run" | "lift">("all");
  const [clockLabel, setClockLabel] = useState("");
  const [showPlanTools, setShowPlanTools] = useState(false);
  const [planMore, setPlanMore] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const trainingDecision = useRef<string | null>(null);
  useEffect(() => {
    const refresh = () => { syncScheduleProgress(); setCalendar(loadSchedule().entries); setHomeRev(n => n + 1); };
    refresh(); const unsubscribe = onAppEvent(refresh);
    window.addEventListener('fk-schedule-changed', refresh); window.addEventListener('storage', refresh);
    return () => { unsubscribe(); window.removeEventListener('fk-schedule-changed', refresh); window.removeEventListener('storage', refresh); };
  }, []);
  const openScheduled = (entry: ScheduleEntry) => { setCalendar(loadSchedule().entries); setTimerPicker(false); setExecutionEntryId(entry.id); };
  useEffect(() => { const h = (ev: Event) => { const id = (ev as CustomEvent<string>).detail; const all = loadSchedule().entries; if (all.some(e => e.id === id)) { setCalendar(all); setTimerPicker(false); setExecutionEntryId(id); } }; window.addEventListener("fk-open-scheduled", h); return () => window.removeEventListener("fk-open-scheduled", h); }, []);
  const resumeSession = (id: string) => {
    const e = loadSchedule().entries.find(e => [scheduleExecutionId(e.id, 'strength'), scheduleExecutionId(e.id, 'run')].includes(id));
    if (e) { openScheduled(e); return; }
    const i = plan.sessions.findIndex(s => s.id === id);
    if (i >= 0) { setActive(i); setCourseChoice(`lift:${id}`); setWorkspaceMounted(true); setWorkspaceOpen(true); setTab('today'); return; }
    if (listTrackPlans().some(p => p.planId === id)) { setCourseChoice(`run:${id}`); setWorkspaceMounted(true); setWorkspaceOpen(true); setTab('today'); return; }
    setNotice('进行中的课程已有记录，但对应安排暂不可读。请在日志核对，未另开课程。');
  };
  const editScheduled = (entry: ScheduleEntry) => {
    const active = listTrainingOccurrences().some(o => o.lifecycle === 'IN_PROGRESS' && [scheduleExecutionId(entry.id, 'strength'), scheduleExecutionId(entry.id, 'run')].includes(o.sessionId));
    if (active) { setNotice('这节训练正在执行，当前组和休息已保留。请结束本课次后再修改日期、类型或训练参数。'); return; }
    setTrainingEditor({ date: entry.date, initial: entry });
  };
  // v81（t510–t512）：「计时」按当天情况走同一个逐组引导：进行中的先继续；今天是 V4 课就先确保有可执行条目；
  // 当天只有一节 → 直接打开；多节 → 让用户选；一节都没有 → 选择页里只给普通计时器。
  const openTimer = async () => {
    const active = listTrainingOccurrences().filter(o => o.lifecycle === 'IN_PROGRESS' && !occurrenceVoided(o.trainingOccurrenceId));
    if (active.length === 1) { resumeSession(active[0].sessionId); return; }
    if (planSrc === '400m-v4' && selectedDate === todayIso) await ensurePlan400Entry(todayIso).catch(() => null);
    const all = loadSchedule().entries; setCalendar(all);
    const choices = scheduledChoices(all, selectedDate);
    if (choices.length === 1) openScheduled(choices[0]); else setTimerPicker(true);
  };
  useEffect(() => { const h = (ev: Event) => { const det = (ev as CustomEvent<{ date: string; handled: boolean }>).detail; det.handled = true; void (async () => {
    const active = listTrainingOccurrences().filter(o => o.lifecycle === 'IN_PROGRESS' && !occurrenceVoided(o.trainingOccurrenceId) && o.sessionId.startsWith(`scheduled:plan400:${det.date}:`));
    if (active.length) { resumeSession(active[0].sessionId); return; }
    const r = await ensurePlan400Entry(det.date).catch(() => ({ id: null }));
    const all = loadSchedule().entries; setCalendar(all);
    if (r.id && all.some(e => e.id === r.id)) { setTimerPicker(false); setExecutionEntryId(r.id); } else openPlan400Day(det.date, 'during');
  })(); }; window.addEventListener(PLAN400_GUIDED_EVT, h); return () => window.removeEventListener(PLAN400_GUIDED_EVT, h); }, []);
  const templateEntry = (id: string): ScheduleEntry | undefined => {
    const s = plan.sessions.find(s => s.id === id); if (!s) return;
    return { ...strengthEntry(s, selectedDate, 'custom'), title: s.name, exercises: s.moves.map(m => ({ id: uid(), catalogId: m.catalogId, name: displayName(m), sets: String(m.sets), reps: String(m.amount), weight: String(m.weightKg), rpe: '', unit: m.mode === 'seconds' ? 'sec' : 'reps', restSec: m.restSec })) };
  };


  useEffect(() => {
    bootCore();
    planRaw.current = window.localStorage.getItem(PLAN_KEY);
    const saved = loadPlan();
    if (saved) setPlan(saved);
    else setPlan(starter);
    setReady(true);
    setClockLabel(new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date()));
    setProfile(loadProfile());
    const loadedPreference = loadSportGoal();
    setPreference(loadedPreference);
    setSupportingGoals(loadSupportingGoals(localStorage, loadedPreference.primaryGoal));
  }, []);

  useEffect(() => {
    const trend = bodyTrend();
    setWeightText(trend.latest ? `${trend.latest.weight} 公斤${trend.latest.fat != null ? `，脂肪率 ${trend.latest.fat}%` : ""}` : null);
    const day = loadDay();
    const km = day.runs.reduce((sum, run) => sum + run.km, 0);
    setRunKm(day.runs.length ? Number(km.toFixed(2)) : null);
    const eaten = todayEaten();
    setKcal(eaten > 0 ? eaten : null);
  }, [preference, tab]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const commit = () => {
      if (cancelled) return;
      const result = savePlanCompared(window.localStorage, planRaw.current, plan);
      setPlanSaveFailed(!result.ok);
      if (result.ok) { planRaw.current = result.raw; setPlanConflict(""); }
      else setPlanConflict(result.reason);
    };
    if (navigator.locks?.request) void navigator.locks.request("fr255-strength-plan-v3", commit);
    else { setPlanSaveFailed(true); setPlanConflict("浏览器不支持课表写入锁，暂不保存。草稿仍在，请换支持 Web Locks 的浏览器。"); }
    return () => { cancelled = true; };
  }, [plan, ready]);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    let registration: ServiceWorkerRegistration | null = null;
    let stopped = false;
    let prefetchInFlight: Promise<void> | null = null;
    const prefetch = () => {
      if (prefetchInFlight) return prefetchInFlight;
      const urls = offlinePrefetchUrls(location.origin,
        [...document.querySelectorAll("script[src], link[href]")]
          .map((node) => ("src" in node && typeof node.src === "string" && node.src ? node.src : node.getAttribute("href")) || ""),
        performance.getEntriesByType("resource").map(entry => entry.name),
      );
      prefetchInFlight = Promise.all(urls.map((href) => fetch(href, {
        cache: "reload",
        ...(new URL(href, location.origin).pathname === "/" ? { headers: { accept: "text/html", "x-fangkun-shell-prefetch": "1" } } : {}),
      }).catch(() => undefined))).then(async () => {
        const critical = urls.filter(href => {const path = new URL(href).pathname; return path === "/" || path.startsWith("/assets/") && /\.(?:m?js|css)$/.test(path)});
        const cached = await Promise.all(critical.map(href => caches.match(href, { ignoreVary: true })));
        if (!stopped) setOfflineShellState(cached.length > 0 && cached.every(response => response?.ok) ? "ready" : "unavailable");
      }).catch(() => {if (!stopped) setOfflineShellState("unavailable")}).finally(() => {prefetchInFlight = null});
      return prefetchInFlight;
    };
    const apply = () => {
      if (stopped || !("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
      let trainingOpen = true;
      try { trainingOpen = trainingExecutionOpen(loadEvents()); } catch { trainingOpen = true; }
      const plan = serviceWorkerNavigationPlan({
        hasController: !!navigator.serviceWorker.controller,
        alreadyReloaded: sessionStorage.getItem("fr255-sw-reloaded") === "1",
        trainingOpen,
      });
      if (plan.reload) {
        sessionStorage.setItem("fr255-sw-reloaded", "1");
        location.reload();
        return;
      }
      if (plan.prefetch) void prefetch();
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(async (next) => {
        registration = next;
        void next.update().catch(() => {});
        await navigator.serviceWorker.ready;
        apply();
      }).catch(() => {if (!stopped) setOfflineShellState("unavailable")});
      navigator.serviceWorker.addEventListener("controllerchange", apply);
    } else setOfflineShellState("unavailable");
    const update = () => { if (navigator.onLine) {void registration?.update(); apply()} };
    window.addEventListener("online", update);
    return () => {
      stopped = true;
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.removeEventListener("online", update);
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("controllerchange", apply);
    };
  }, []);

  const session = plan.sessions[Math.min(active, plan.sessions.length - 1)] ?? plan.sessions[0];
  const minutes = session ? estimateMinutes(session) : 0;
  const variant = homeVariant(preference);
  const trackHome = ready ? trackHomeView() : null;
  const quickAction = (q: QuickId | "more") => {
    if (q === "more") return setEditHome(true);
    if (q === "log") return setQuickOpen({ text: "", n: Date.now() });
    if (q === "weight") return setQuickOpen({ text: "体重 ", n: Date.now() });
    if (q === "import") { setBodyPane("device"); return setTab("body"); }
    if (q === "health") { setBodyPane("recovery"); return setTab("body"); }
    if (q === "coach") { setCoachLink("ask"); setCoachFocus(null); return setTab("coach"); }
    if (q === "diet") return setTab("diet");
    openTimer();
  };
  const openDetail = () => openTimer();
  const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  useLocalReminders(todayIso);
  const liftLogged = Boolean(session && plan.cycle?.logs.some((log) => log.sessionId === session.id));
  const courseCount = (trackHome?.planId ? 1 : 0) + (session ? 1 : 0);
  // Part records and undated legacy feedback cannot establish whole-course completion.
  const doneCount = 0;
  const liftSummary = (session?.moves ?? []).slice(0, 4).map((move) => displayName(move)).join(" · ");
  const statusText = !ready ? "读取中" : trackHome?.openOccurrenceId ? "跑步进行中" : courseCount === 0 ? "暂无安排" : "待选择课程";
  const pageTitle = tab === "today" ? "今日训练" : tab === "plan" ? "训练计划" : tab === "log" ? "训练日志" : tab === "coach" ? "方坤 AI · 测试版" : tab === "diet" ? "饮食" : "健康";
  const phaseLabel = plan.cycle ? PHASES.find((item) => item.week === plan.cycle?.week)?.label ?? "" : "";
  const headerHint = tab === "today"
    ? (clockLabel ? `${clockLabel} · ${statusText}` : statusText)
    : tab === "plan"
      ? (plan.cycle ? `第 ${plan.cycle.week} 周 · ${phaseLabel}` : "周期未就绪")
      : tab === "log"
        ? ""
        : tab === "coach"
          ? "对话 · 学习 · 复盘"
          : "";
  const coachHint = !ready
    ? "正在读取本机记录。"
    : trackHome?.openOccurrenceId
      ? trackHome.progress
      : "";

  function choosePreference(next: SportGoalPreference) {
    if (typeof localStorage === "undefined" || !saveSportGoal(next, localStorage)) {
      setGoalSaveFailed(true);
      return;
    }
    setGoalSaveFailed(false);
    const loadedPreference = loadSportGoal();
    setPreference(loadedPreference);
    setSupportingGoals(loadSupportingGoals(localStorage, loadedPreference.primaryGoal));
  }

  const filtered = useMemo(() => {
    const q = query.trim();
    return CATALOG.filter((item) => {
      if (group !== "全部" && item.group !== group) return false;
      if (!q) return true;
      return item.name.includes(q) || item.group.includes(q);
    });
  }, [group, query]);

  function updateSession(patch: Partial<{ name: string; moves: Move[] }>) {
    if (!session) return;
    if (patch.moves) captureOriginalPlan(session);
    setPlan((current) => ({
      ...current,
      sessions: current.sessions.map((item) => (item.id === session.id ? { ...item, ...patch } : item)),
    }));
  }

  function commitPlan(produce: (current: Plan) => Plan) {
    for (const item of plan.sessions) captureOriginalPlan(item);
    setPlan(produce(plan));
  }

  function updateMove(id: string, patch: Partial<Move>) {
    if (!session) return;
    updateSession({
      moves: session.moves.map((move) => (move.id === id ? { ...move, ...patch } : move)),
    });
    if (trainingDecision.current) {
      dispatchEvent("TRAINING_MODIFIED", { decisionId: trainingDecision.current, sessionId: session.id });
    }
  }

  function removeMove(id: string) {
    if (!session) return;
    updateSession({ moves: session.moves.filter((move) => move.id !== id) });
  }

  function shiftMove(id: string, dir: -1 | 1) {
    if (!session) return;
    const list = [...session.moves];
    const index = list.findIndex((move) => move.id === id);
    const next = index + dir;
    if (index < 0 || next < 0 || next >= list.length) return;
    const [item] = list.splice(index, 1);
    if (!item) return;
    list.splice(next, 0, item);
    updateSession({ moves: list });
  }

  function applyTemplate(id: string) {
    const template = TEMPLATES.find((item) => item.id === id);
    if (!template) return;
    commitPlan((current) => ({ ...ensureCycle(template.plan()), coachEditHistory: current.coachEditHistory, coachEditRevision: current.coachEditRevision }));
    setActive(0);
    setNotice(`已换成「${template.label}」，重量和次数都能改。`);
  }

  // FRAME-14: explicit user-controlled strength-session order change.
  // Keep session IDs, contents, historical logs and event identities unchanged.
  function reorderStrengthSession(direction: -1 | 1) {
    const target = active + direction;
    if (target < 0 || target >= plan.sessions.length) return;
    const currentSession = plan.sessions[active];
    const otherSession = plan.sessions[target];
    if (!currentSession || !otherSession) return;
    const accepted = window.confirm(
      `确认将「${currentSession.name}」与「${otherSession.name}」交换本周期显示顺序？\n\n这仅调整力量课表的排列，不代表已执行，也不等于方坤确认恢复或负荷安全。请检查高强度跑步、下肢力量、疼痛和比赛安排。已有训练记录保留原课程编号。`,
    );
    if (!accepted) return;
    setPlan((current) => {
      const sessions = [...current.sessions];
      const currentIndex = sessions.findIndex((item) => item.id === currentSession.id);
      const nextIndex = sessions.findIndex((item) => item.id === otherSession.id);
      if (currentIndex < 0 || nextIndex < 0) return current;
      [sessions[currentIndex], sessions[nextIndex]] = [sessions[nextIndex]!, sessions[currentIndex]!];
      return { ...current, sessions };
    });
    setActive(target);
    setNotice(`已调整力量课程顺序：${currentSession.name}。保存状态请查看页面顶部提示；跑步计划与历史日志未改。`);
  }

  // Preview-only. The plan and its audit are written in one localStorage value.
  // All current UI plan writers use the same lock and reject stale plan versions.
  const onControlledStrengthEdit: CoachStrengthAction = async (action, proposal, consent) => {
    if (typeof navigator === "undefined" || !navigator.locks?.request) return {ok:false,reason:"此浏览器不支持安全互斥锁，仅可查看提案，不能写入。"};
    return navigator.locks.request(PLAN_KEY, async () => {
      try {
        const raw = localStorage.getItem("fr255-strength-plan-v3");
        if (!raw || raw !== JSON.stringify(plan)) return {ok:false,reason:"本机计划已变化，拒绝覆盖；请刷新并重新生成提案。"};
        if (action === "APPLY" && (!proposal || raw !== proposal.expectedPlanRaw)) return {ok:false,reason:"提案已过期，不能写入。"};
        const today = new Date().toDateString();
        const startedToday = loadEvents().some(e => e.event_type === "TRAINING_STARTED" && new Date(e.timestamp).toDateString() === today &&
          e.payload && typeof e.payload === "object" && (e.payload as Record<string,unknown>).sessionId === (action === "APPLY" ? proposal?.sessionId : plan.coachEditHistory?.at(-1)?.sessionId));
        const recentPain = loadEvents().some(e => e.event_type === "PAIN_RECORDED" && Number.isFinite(Date.parse(e.timestamp)) &&
          Date.now() - Date.parse(e.timestamp) >= 0 && Date.now() - Date.parse(e.timestamp) <= 14 * 86400_000);
        const control: StrengthControl = {previewUnlocked:consent.previewUnlocked,athleteConfirmed:consent.athleteConfirmed,
          confirmedProposalId:consent.confirmedProposalId,hasTrainingStartedToday:startedToday || trainingExecutionOpen(loadEvents()),
          unresolvedPain:!consent.noCurrentPain || recentPain,timestamp:new Date().toISOString()};
        const result = action === "APPLY" ? applyStrengthReduction(plan,proposal!,control) : rollbackStrengthReduction(plan,control);
        if (!result.ok) return {ok:false,reason:result.reason};
        // Same-key plan+audit update: a failed write leaves both untouched.
        const saved = commitControlledStrengthPlan(localStorage, raw, result.plan);
        if (!saved.ok) return saved;
        planRaw.current=JSON.stringify(result.plan);
        setPlan(result.plan);
        return {ok:true,reason:result.reason};
      } catch {return {ok:false,reason:"无法读取或写入本机计划，已拒绝修改。"};}
    });
  };

  function addSession() {
    const next = { id: uid(), name: `第 ${plan.sessions.length + 1} 节`, moves: [] as Move[] };
    setPlan((current) => ({ ...current, sessions: [...current.sessions, next] }));
    setActive(plan.sessions.length);
    setPicker(true);
  }



  return (
    <div className={"app-wallpaper product-ui bg-bg text-fg " + (tab === "coach" ? "flex h-dvh flex-col overflow-hidden" : "min-h-screen")} data-testid="training-app" data-ready={ready} data-offline-ready={offlineShellState === "ready"} data-candidate-version="FK-V74-UI-INTEGRATED-20261017" data-wallpaper={wallpaper} data-theme={displayMode === "system" ? (systemDark ? "dark" : "light") : displayMode}>
      <header className="ui03-header px-4 pt-1 pb-1">
        <div className="ui03-header-inner mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            {tab === "today" ? <><h1 className="text-[1.6rem] font-black italic leading-none tracking-wide">FANGKUN</h1><p className="text-sm font-bold">更好的你</p></> : <>
            <h1 className="ui03-title text-[1.55rem] font-bold leading-tight tracking-tight">{pageTitle}</h1>
            <p className="ui03-subtitle truncate text-xs text-muted">{headerHint}</p></>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
          {tab === "today" ? <button type="button" aria-label="记一笔" onClick={() => window.dispatchEvent(new Event("fk-open-quicklog"))} className="flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-line px-3 text-sm font-bold text-accent"><Plus className="size-4" />记一笔</button> : null}
          <button type="button" onClick={() => { if (tab === "coach") { setTab(prevTab.current); } else { prevTab.current = tab; setCoachLink("ask"); setCoachFocus(null); setTab("coach"); } }} className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-accent bg-surface shadow-sm" aria-label={tab === "coach" ? "关闭方坤" : "打开方坤"}>{tab === "coach" ? <X className="size-5" /> : <img src="/fangshen/happy-bust.png" alt="" className="size-full object-cover object-top" />}</button>
          <button type="button" onClick={() => { menuScrollTop.current = 0; setSettingsPaneRaw("menu"); setSettingsOpen(true); }} className="ui03-settings grid size-11 shrink-0 place-items-center rounded-full bg-surface shadow-sm" aria-label="个人与数据"><Settings className="size-5" /></button></div>
        </div>
      </header>
      {offline ? <p className="mx-auto max-w-3xl px-4 pb-2 text-sm text-muted">当前没有网络。已缓存页面和本机记录可继续使用；方坤本地问答仍可用。</p> : null}
      {!offline && offlineShellState !== "ready" ? <p role="status" className="mx-auto max-w-3xl px-4 pb-2 text-xs text-muted">{offlineShellState === "preparing" ? "正在准备离线使用，首次打开请保持网络。" : "离线页面还未准备完成，联网后重新打开可重试。"}</p> : null}
      {planSaveFailed ? <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-4 pb-2 text-sm">
        <p>{planConflict || PLAN_SAVE_FAIL}</p>
        <button type="button" className="min-h-11 rounded-card border border-line px-3 font-bold" onClick={() => { if (navigator.locks?.request) void navigator.locks.request(PLAN_KEY, () => { const result = savePlanCompared(localStorage, planRaw.current, plan); if(result.ok){planRaw.current=result.raw;setPlanSaveFailed(false);setPlanConflict("");}else setPlanConflict(result.reason); }); }}>再存一次</button>
        <button type="button" className="min-h-11 rounded-card border border-line px-3 font-bold" onClick={() => { setSettingsPaneRaw("backup"); setSettingsOpen(true); }}>下载备份</button>
      </div> : null}

      <main className={"ui03-main mx-auto max-w-3xl px-3 pt-2 pb-nav" + (tab === "today" || tab === "plan" ? "" : " hidden")}>
        {tab === "today" ? (
          <div className="flex flex-col">
            {/* R4: hero intro removed to keep 今日 short; status lives in the strip below. */}

            <div className="mb-3 flex justify-center"><span className="rounded-full border border-line px-4 py-1.5 text-sm">{Number(todayIso.slice(5,7))}月{Number(todayIso.slice(8,10))}日 周{"日一二三四五六"[new Date(todayIso + "T12:00:00").getDay()]}</span></div>{planSrc === "400m-v4" ? <Plan400TodayCard today={todayIso} onReview={() => setTab("log")} /> : null}<HomeHeader today={todayIso} revision={homeRev} onRecovery={() => { setBodyPane("recovery"); setTab("body"); }} onOverride={(o) => setDayOverride(o)} layout={homeLayout} onEdit={() => setEditHome(true)} onQuick={quickAction} />
            <div style={{ order: homeLayout.order.indexOf("week") }}><TodayBoard v4={planSrc === "400m-v4"} revision={homeRev} override={dayOverride} band={bandOn} plan={plan} runPlans={ready ? listTrackPlans() : []} today={todayIso} selectedDate={selectedDate} onDateChange={setSelectedDate} onExecute={openScheduled} onEdit={editScheduled}
              onOpenRun={(planId) => { if (!workspaceOpen) setCourseChoice(`run:${planId}`); openDetail(); }}
              onOpenLift={(sessionId) => { if (!workspaceOpen) { setCourseChoice(`lift:${sessionId}`); const i = plan.sessions.findIndex((x) => x.id === sessionId); if (i >= 0) setActive(i); } openDetail(); }}
              onFood={() => { setTab("diet"); }}
              onAskCoach={() => { setCoachLink("ask"); setCoachFocus(null); setTab("coach"); }} /></div>
            <section id="detail-record" aria-label="本日训练执行入口" style={{ order: homeLayout.order.indexOf("detail") }} className="mb-3 px-1">
              <button type="button" className="flex min-h-12 w-full items-center justify-between rounded-xl border border-line px-4 text-left text-sm" onClick={openTimer}><span><b className="block">其他训练 · 计时与逐组记录</b><span className="block text-xs text-muted">自建/方坤安排的课程，开始或继续同一节</span></span><span aria-hidden="true" className="text-muted">›</span></button>
            </section>
            <div style={{ order: 100 }} className="h-20" aria-hidden="true" />
          </div>
        ) : null}
        {workspaceMounted ? <section hidden={!workspaceOpen||tab!=="today"} aria-label="训练工作区" className="mb-4 space-y-3 rounded-card border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2"><h2 className="font-bold">当前课程 · {courseChoice.startsWith("run:") ? courseChoice.slice(4) : session?.name}</h2><button type="button" className="min-h-11 text-sm" onClick={()=>{if(trainingDecision.current){setNotice("请先在执行页暂停或结束当前力量课，再选择其他课程。");return;}setWorkspaceOpen(false);}}>返回课程选择</button></div>
          {courseChoice.startsWith("run:") ? <TrackSessionPanel selectedPlanId={courseChoice.slice(4)} onLog={()=>setTab("log")} /> : session ? <>
            <TrainingDecisionCard key={session.id} plan={plan} session={session} onApply={next=>updateSession(next)} onLive={id=>{trainingDecision.current=id;}} />
            <details className="rounded-xl border border-line p-3"><summary className="min-h-11 cursor-pointer font-bold">已保存的课程安排</summary><SessionOverview name={session.name} focus={session.focus} moves={session.moves} minutes={minutes} onEdit={()=>{setEditorOpen(true);setPlanMore(true);setTab("plan");}} /></details>
          </> : <p>选定课程已不存在，请重新选择。</p>}
        </section> : null}
        {tab === "plan" ? <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1" role="group" aria-label="运动专区">
          {([['run', '跑步', Footprints], ['lift', '力量', Dumbbell]] as const).map(([id, title, Icon]) => <button type="button" key={id} aria-pressed={hubPane === id} onClick={() => setHubPane(id)} className={'flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-bold ' + (hubPane === id ? 'bg-accent text-accent-fg' : 'text-muted')}><Icon className="size-4" />{title}</button>)}
        </div> : null}
        {tab === 'plan' && hubPane === 'lift' ? <section className="home-card mb-3 space-y-3 p-4" aria-label="力量训练入口"><h2 className="text-lg font-black">从肌肉开始选动作</h2><button type="button" className="flex min-h-20 w-full items-center justify-between rounded-2xl border border-accent bg-accent/10 p-4 text-left text-accent" onClick={() => setTrainingEditor({ date: selectedDate, openMuscleInitially: true })}><span><b className="block">人体肌肉 3D</b><span className="keep mt-1 block text-xs">点选肌肉 → 选择动作 → 加入这节训练</span></span><span>›</span></button><div className="grid grid-cols-2 gap-2"><button type="button" className="min-h-12 rounded-xl border border-line font-bold" onClick={() => setActionLibrary(true)}>动作库</button><button type="button" className="min-h-12 rounded-xl bg-accent font-bold text-accent-fg" onClick={() => setTrainingEditor({ date: selectedDate })}>＋添加力量训练</button></div></section> : null}
        {tab === 'plan' && hubPane === 'lift' ? <TempTrainingList entries={calendar} modality="strength" title="已排力量训练" addLabel="按日期查看" onAdd={() => setTab('today')} onOpen={openScheduled} empty="还没有排期，先选动作或从下方课程库添加。" /> : null}
        {tab === 'plan' && hubPane === 'lift' ? <section className="home-card mb-3 p-4" aria-label="力量课程库"><h2 className="font-bold">已保存的力量课程</h2>{plan.sessions.map(s => <div key={s.id} className="flex items-center justify-between gap-3 border-t border-line py-3"><span className="min-w-0"><b className="block">{s.name}</b><span className="text-xs text-muted">{s.moves.length}个动作</span></span><button type="button" className="min-h-11 shrink-0 rounded-full border border-line px-3 text-sm font-bold text-accent" onClick={() => setTrainingEditor({ date: selectedDate, template: templateEntry(s.id) })}>加入训练</button></div>)}</section> : null}
        
        {tab === "plan" && hubPane === "run" && planSrc === "400m-v4" ? <Plan400Cycle today={todayIso} sourceSlot={<PlanSourceCard active={planSrc} onChange={setPlanSrcSaved} onGenerate={() => { setPlanSrcSaved("generated"); setCoachLink("ask"); setCoachFocus(null); setTab("coach"); }} />} /> : null}
        {tab === "plan" && hubPane === "run" && planSrc !== "400m-v4" ? <PlanSourceCard active={planSrc} onChange={setPlanSrcSaved} onGenerate={() => { setPlanSrcSaved("generated"); setCoachLink("ask"); setCoachFocus(null); setTab("coach"); }} /> : null}
        {tab === "plan" && hubPane === "run" ? <TempTrainingList entries={calendar} modality="run" title="临时 / 自建跑步训练" addLabel="＋添加跑步" onAdd={() => setTrainingEditor({ date: selectedDate, initialType: 'run' })} onOpen={openScheduled} empty="还没有临时或自建的跑步训练。" footer={<p className="keep mt-2 text-xs text-muted">与上方周期计划分开显示；只有 V4 当天课程生成的训练才算挂靠周期。间歇训练保留每次、每轮与休息结构；未开始的计划不会计入实际训练。</p>} /> : null}
        {tab === "plan" && hubPane === "run" ? <section className="home-card mb-3 p-4" aria-label="训练资源"><h2 className="text-sm font-bold text-muted">训练资源</h2><button type="button" className="mt-2 flex min-h-12 w-full items-center justify-between rounded-xl border border-line px-4 text-left font-bold" onClick={() => setTechniqueLibrary(true)}><span>跑步技术动作库 · 53 项</span><span aria-hidden="true" className="text-muted">›</span></button></section> : null}
        {tab === "plan" && hubPane === "lift" && planSrc === "400m-v4" ? <Plan400Cycle today={todayIso} lens="lift" /> : null}
        {tab === "plan" && hubPane === "lift" ? <section className="home-card product-goal-card mb-3 p-4" aria-label="当前目标">
          <div className="product-section-heading"><div><p className="product-eyebrow">目标与约束</p><h2>{GOALS.find(goal => goal.id === preference.primaryGoal)?.label ?? "目标待确认"}</h2></div><button type="button" className="product-text-action" onClick={() => { setSettingsPane("goals"); setSettingsOpen(true); }}>修改 ›</button></div>
          <p className="mt-2 text-sm text-muted">{profileFilled(profile) ? profileSummary(profile) : "当前能力、期限、可用时间与运动限制，需进一步确认。"}</p>
          <button type="button" className="product-text-action" onClick={() => { setCoachLink("ask"); setCoachFocus(null); setTab("coach"); }}>和方坤完善首周候选计划 ›</button>
        </section> : null}
        {tab === "plan" && hubPane === "lift" ? (
          <details className="home-card mb-3 px-3 py-3" aria-label="力量周期工具"><summary className="min-h-12 cursor-pointer font-bold">力量课程与周期管理</summary>
            <div className="flex items-center justify-between gap-2 px-1">
              <h2 className="font-bold">训练周期</h2>
              <span className="text-xs text-muted">{plan.cycle ? `3 周训练 + 调整周` : "周期未就绪"}</span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1" role="group" aria-label="训练周期周次">
              {PHASES.map((phase) => {
                const current = phase.week === (plan.cycle?.week ?? 1);
                return <button key={phase.week} type="button" aria-pressed={current} onClick={() => setWeekPeek(current ? null : phase.week)} className={"min-h-10 rounded-full text-xs font-bold " + (current ? "bg-surface-2 text-fg" : weekPeek === phase.week ? "text-accent" : "text-muted")}>第{["一", "二", "三", "四"][phase.week - 1]}周</button>;
              })}
            </div>
            {weekPeek && weekPeek !== plan.cycle?.week ? <p className="mt-2 px-1 text-xs text-muted">第 {weekPeek} 周是「{PHASES.find((item) => item.week === weekPeek)?.label}」。下面仍是当前已保存的课表，不会换成示例课。</p> : null}
            <div className="mt-3 grid grid-cols-3 gap-1 rounded-full bg-surface-2 p-1" role="group" aria-label="计划类型">
              {([["all", "全部"], ["run", "跑步"], ["lift", "力量"]] as const).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={planLens === id} onClick={() => setPlanLens(id)} className={"min-h-9 rounded-full text-sm font-bold " + (planLens === id ? "bg-surface text-fg shadow-sm" : "text-muted")}>{label}</button>
              ))}
            </div>
            <div className="mt-1">
              {planLens !== "lift" ? (trackHome?.planId ? <button type="button" onClick={() => { const r = listTrackPlans().find(r => r.planId === trackHome!.planId); if (r) setTrainingEditor({ date: selectedDate, template: { ...runEntry(r, selectedDate, "custom"), runComponents: r.components } }); }} className="flex min-h-16 w-full items-center gap-3 border-b border-line py-2 text-left">
                <span className="chip-run grid size-10 shrink-0 place-items-center rounded-2xl"><Activity className="size-4" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate font-bold">{trackHome.title}</span><span className="block text-xs text-muted">跑步 · 已保存计划 · {trackHome.progress}</span></span>
                <span className="text-lg text-muted" aria-hidden="true">›</span>
              </button> : <p className="border-b border-line py-3 text-sm text-muted">没有已保存的跑步课。</p>) : null}
              {planLens !== "run" ? plan.sessions.map((item, index) => {
                const rest = /恢复|休息/.test(item.name);
                const logged = plan.cycle?.logs.some((log) => log.sessionId === item.id);
                return <button key={item.id} type="button" aria-pressed={index === active} onClick={() => { setActive(index); setEditorOpen(true); setPlanMore(true); }} className={"flex min-h-16 w-full items-center gap-3 border-b border-line px-1 py-2 text-left last:border-b-0 " + (index === active ? "rounded-2xl bg-surface-2" : "")}>
                  <span className={(rest ? "bg-surface text-muted" : "chip-lift") + " grid size-10 shrink-0 place-items-center rounded-2xl"}>{rest ? <Heart className="size-4" /> : <Dumbbell className="size-4" />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-bold">第 {index + 1} 节 {item.name}</span><span className="block text-xs text-muted">{rest ? "恢复" : "力量"} · {item.moves.length} 个动作{logged ? " · 已有反馈" : ""}</span></span>
                  {logged ? <span className="tone-lift text-sm font-bold">✓</span> : <span className="text-lg text-muted" aria-hidden="true">›</span>}
                </button>;
              }) : null}
              {planLens === "lift" && plan.sessions.length === 0 ? <p className="py-3 text-sm text-muted">没有已保存的力量课。</p> : null}
            </div>
          </details>
        ) : null}
        {tab === "plan" && hubPane === "lift" ? <details className="home-card mt-3 px-4 py-2" open={planMore} onToggle={(event) => setPlanMore(event.currentTarget.open)}>
          <summary className="min-h-12 cursor-pointer text-sm font-bold">调整周期、模板和这节课</summary>
        {tab === "plan" && hubPane === "lift" && showPlanTools && plan.sessions.length > 1 ? (
          <nav aria-label="选择要查看的训练课" className="mb-4 rounded-card border border-line bg-surface p-3">
            <p className="mb-2 text-xs font-bold text-muted">查看本周期其他训练课 · 共 {plan.sessions.length} 节</p>
            <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="训练课列表">
              {plan.sessions.map((item, index) => (
                <button key={item.id} type="button" aria-pressed={index === active}
                  onClick={() => setActive(index)}
                  className={"min-h-11 shrink-0 rounded-card border px-3 text-sm font-bold " + (index === active ? "border-accent bg-accent text-accent-fg" : "border-line bg-bg text-fg")}>
                  第 {index + 1} 节 · {item.name}
                  {plan.cycle?.logs.some((log) => log.sessionId === item.id) ? " · 已记" : ""}
                </button>
              ))}
            </div>
            
            <div className="mt-3 rounded-card border border-line p-3">
              <p className="text-sm font-bold">手动调整本周期力量课程顺序</p>
              <p className="mt-1 text-xs text-muted">当前：第 {active + 1} 节 · {session?.name}。调整前会确认；只交换力量课程排列，不更改跑步计划、不自动判断恢复安全、不把课程记为完成。</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={active === 0} onClick={() => reorderStrengthSession(-1)} className="min-h-11 rounded-card border border-line px-4 text-sm font-bold disabled:opacity-40">向前调整一节</button>
                <button type="button" disabled={active >= plan.sessions.length - 1} onClick={() => reorderStrengthSession(1)} className="min-h-11 rounded-card border border-line px-4 text-sm font-bold disabled:opacity-40">向后调整一节</button>
              </div>
              
            </div>
          </nav>
        ) : null}
        {tab === "plan" && hubPane === "lift" ? <section>
          <button type="button" aria-expanded={showPlanTools} onClick={() => setShowPlanTools((current) => !current)} className="flex min-h-11 w-full items-center justify-between rounded-card border border-line bg-surface px-4 text-left text-sm font-bold">
            训练模板与周期管理 {showPlanTools ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          {showPlanTools ? <>
          <h2 className="mt-3 text-sm font-medium text-muted">选一套再改</h2>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {TEMPLATES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => applyTemplate(item.id)}
                className={"min-h-11 shrink-0 rounded-full border px-4 text-left " + (plan.kind === item.id ? "border-accent bg-surface" : "border-line bg-surface")}
              >
                <span className="block text-sm font-bold">{item.label}</span>
                <span className="block text-xs text-muted">{item.hint}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                commitPlan(() => ensureCycle(blankPlan()));
                setActive(0);
                setNotice("从空白课开始。");
              }}
              className="min-h-11 shrink-0 rounded-full border border-line px-4 text-sm font-bold"
            >
              自己排
            </button>
          </div>
          {profileFilled(profile) && plan.sessions.length > profile.days ? (
            <p className="mt-2 text-sm text-muted">你填了一周练 {profile.days} 次，这套有 {plan.sessions.length} 节。多出来的记成「这周没练」就行。</p>
          ) : null}
          <CycleCard
            plan={plan}
            onAdvance={() => {
              if (!weekReady(plan)) {
                setNotice("每节都记下感觉，才能生成下一周。没练的选「这周没练」。");
                return;
              }
              commitPlan((current) => advanceCycle(current).plan);
              setActive(0);
              setNotice("下一周已经按这周的反馈改好了。");
            }}
          />
          </> : null}
        </section> : null}
        {tab === "plan" && hubPane === "lift" ? <details className="mt-3 rounded-card border border-line bg-surface p-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">实验功能 · 周期计划候选</summary>
          
          <button
            type="button"
            onClick={() => setCoachPlanOpen(true)}
            className="mt-3 flex min-h-14 w-full items-center justify-between rounded-card border border-line bg-bg px-4 text-left"
          >
            <span>
              <span className="block font-bold">查看实验候选</span>
              <span className="block text-sm text-muted">不会写进今天的课表</span>
            </span>
            <ChevronUp className="size-5 rotate-45 text-accent" />
          </button>
        </details> : null}


        {tab === "plan" ? <button type="button" className="mt-4 min-h-12 w-full rounded-card bg-accent font-bold text-accent-fg" onClick={()=>setBuilderOpen(true)}>按多个部位组合一课</button> : null}
        {tab === "plan" ? <details id="session-editor" open={editorOpen} onToggle={(event) => setEditorOpen(event.currentTarget.open)} className="mt-5 rounded-card border border-line bg-surface p-3">
          <summary className="cursor-pointer text-sm font-bold">调整这节课</summary>
          <div className="mt-3 flex items-center gap-2 overflow-x-auto">
            {plan.sessions.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActive(index)}
                className={"min-h-11 shrink-0 rounded-full px-4 text-sm font-bold " + (index === active ? "bg-accent text-accent-fg" : "bg-surface text-fg")}
              >
                {item.name}
                {plan.cycle?.logs.some((log) => log.sessionId === item.id) ? <span className="ml-1 text-xs font-medium">已记</span> : null}
              </button>
            ))}
            <button type="button" onClick={addSession} className="grid size-11 shrink-0 place-items-center rounded-full border border-line" aria-label="加一节课">
              <Plus className="size-5" />
            </button>
          </div>

          {session ? (
            <div className="mt-4">
              <label className="block text-sm text-muted" htmlFor="session-name">
                这节课的名字
              </label>
              <input
                id="session-name"
                value={session.name}
                maxLength={24}
                suppressHydrationWarning
                onChange={(event) => updateSession({ name: event.target.value })}
                className="mt-1 h-12 w-full rounded-card border border-line bg-surface px-3 text-lg font-bold outline-none"
              />
              <p className="mt-2 text-sm text-muted">
                大约 {minutes} 分钟 · {session.moves.length} 个动作
              </p>
              {session.focus ? <p className="mt-1 text-sm text-fg">{session.focus}</p> : null}
              {profile && minutes > profile.minutes + 5 ? (
                <p className="mt-1 text-sm text-warn">这节约 {minutes} 分钟，你填的晚上只有 {profile.minutes} 分钟。跟教练说「只有{profile.minutes}分钟」会帮你砍短。</p>
              ) : null}
              {profile && /膝/.test(profile.limit) && session.moves.some((move) => ["goblet", "bss", "step-up", "db-lunge"].includes(move.catalogId ?? "")) ? (
                <p className="mt-1 text-sm text-warn">你填过：{profile.limit}。这节有蹲，疼就停，或跟教练说膝盖不舒服。</p>
              ) : null}
              <ul className="mt-3 flex flex-col gap-3">
                {session.moves.map((move, index) => (
                  <li key={move.id} className="rounded-card border border-line bg-surface p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-muted">动作 {index + 1}</p>
                        <p className="text-base font-bold">{displayName(move)}</p>
                        <button type="button" onClick={() => setFormMove(move)} className="mt-1 text-sm font-bold text-accent">
                          怎么做
                        </button>
                      </div>
                      <div className="flex">
                        <IconButton label="上移" disabled={index === 0} onClick={() => shiftMove(move.id, -1)}>
                          <ChevronUp className="size-4" />
                        </IconButton>
                        <IconButton label="下移" disabled={index === session.moves.length - 1} onClick={() => shiftMove(move.id, 1)}>
                          <ChevronDown className="size-4" />
                        </IconButton>
                        <IconButton label="删除" onClick={() => removeMove(move.id)}>
                          <Trash2 className="size-4" />
                        </IconButton>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Stepper label="组数" value={move.sets} min={1} max={12} step={1} onChange={(sets) => updateMove(move.id, { sets })} />
                      <Stepper
                        label={move.mode === "seconds" ? "每组秒数" : "每组次数"}
                        value={move.amount}
                        min={1}
                        max={move.mode === "seconds" ? 300 : 50}
                        step={move.mode === "seconds" ? 5 : 1}
                        onChange={(amount) => updateMove(move.id, { amount })}
                      />
                      <Stepper label="组间休息" suffix="秒" value={move.restSec} min={0} max={300} step={15} onChange={(restSec) => updateMove(move.id, { restSec })} />
                      <Stepper label="重量" suffix="kg" value={move.weightKg} min={0} max={200} step={2.5} onChange={(weightKg) => updateMove(move.id, { weightKg })} />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Toggle pressed={move.mode === "reps"} onClick={() => updateMove(move.id, { mode: "reps", amount: move.mode === "reps" ? move.amount : 10 })}>
                        计次数
                      </Toggle>
                      <Toggle
                        pressed={move.mode === "seconds"}
                        onClick={() => updateMove(move.id, { mode: "seconds", amount: move.mode === "seconds" ? move.amount : 30 })}
                      >
                        倒计时
                      </Toggle>
                      {move.weightKg === 0 ? <span className="self-center text-xs text-muted">自重</span> : null}
                    </div>
                  </li>
                ))}
              </ul>

              {session.moves.length === 0 ? (
                <p className="mt-4 rounded-card border border-dashed border-line px-4 py-8 text-center text-sm text-muted">这节还是空的。加上第一个动作。</p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setPicker(true);
                }}
                className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-card border border-line bg-surface-2 font-bold"
              >
                <Plus className="size-5" />
                添加动作
              </button>
            </div>
          ) : null}
        </details> : null}
        </details> : null}

        {notice ? <p className="mt-4 text-sm text-warn">{notice}</p> : null}
      </main>
      {tab === "log" ? <TrainingLogPage today={todayIso} plan={plan} onNavigate={(next) => setTab(next as typeof tab)} onAsk={(occurrenceId) => { setCoachLink(occurrenceId ? "bound" : "unbound"); setCoachFocus(occurrenceId); setTab("coach"); }} /> : null}
      {tab === "coach" ? <CoachSheet embedded plan={plan} activeId={session?.id} focusOccurrenceId={coachFocus} link={coachLink} onControlledStrengthEdit={onControlledStrengthEdit} onClose={() => setTab("today")} onJump={() => { setBodyPane("recovery"); setTab("body"); }} onNavigate={(next) => { setTab(next === "body" ? "diet" : next); }}
        coordinationPanel={<CoachCoordinationHub input={{ loaded: ready, todayPlanned: courseCount, todayMarkedDone: doneCount, strengthSessions: plan.sessions.length }} onNavigate={(next) => setTab(next)} />}
      /> : null}
      <div className={tab === "diet" ? "" : "hidden"}><div className="px-3 pt-3 pb-nav"><HomeDashboard only="diet" onFood={() => { setDietSheet(true); setTimeout(() => document.getElementById("quick-food")?.scrollIntoView(), 50); }} onAdvice={() => setDietSheet(true)} onBody={() => { setBodyPane("trend"); setTab("body"); }} /></div>{dietSheet ? <div className="fixed inset-0 z-50 overflow-y-auto bg-bg pb-10" role="dialog" aria-label="饮食详情"><div className="sticky top-0 z-10 flex min-h-12 items-center justify-between border-b border-line bg-bg px-4 pb-1" style={{ paddingTop: "max(4px, env(safe-area-inset-top))" }}><b>饮食详情与依据</b><button type="button" className="min-h-11 px-3" onClick={() => setDietSheet(false)}>关闭</button></div><div className="fk-detail"><DietPage active={tab === "diet"} profile={profile} onEditProfile={() => setProfileOpen(true)} /></div></div> : null}</div>
      <div className={tab === "body" ? "" : "hidden"}><div className="px-3 pt-3 pb-nav"><HomeDashboard only="body" onFood={() => setTab("diet")} onBody={() => setBodyPane("trend")} slot={<BodyCenter compact active={tab === "body"} initialPane={bodyPane} profile={profile} onEdit={() => setProfileOpen(true)} onProfile={(next) => { saveProfile(next); setProfile(next); }} />} /></div>
      </div>
      <StandaloneWelcome />
      {settingsOpen ? (
        <div ref={settingsScroll} className="fixed inset-0 z-40 overflow-y-auto bg-bg" data-testid="settings-overlay">
        <div className="mx-auto max-w-3xl px-4 pb-nav" style={{ paddingTop: "max(6px, env(safe-area-inset-top))" }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.16em] text-accent">{settingsPane === "menu" ? "RUNNING & STRENGTH" : "个人与设置"}</p>
              <h2 className="text-[1.55rem] font-bold">{({ menu: "个人与设置", athlete: "运动员档案", goals: "训练目标与赛季计划", health: "健康与训练限制", sync: "设备连接与同步", import: "数据导入", backup: "备份与恢复", coach: "教练与提醒", theme: "外观与显示", ai: "AI 服务与联网功能", privacy: "隐私与数据流向" } as Record<SettingsPane, string>)[settingsPane]}</h2>
            </div>
            <button type="button" onClick={() => setSettingsOpen(false)} className="grid size-11 place-items-center rounded-full bg-surface shadow-sm" aria-label="关闭设置"><X className="size-5" /></button>
          </div>
          {settingsPane === "menu" ? <SettingsMenu profile={profile} sportGoal={`${SPORTS.find((item) => item.id === preference.sport)?.label ?? "项目未选"} · ${GOALS.find((item) => item.id === preference.primaryGoal)?.label ?? "目标未选"}`} displayText={`${displayMode === "light" ? "浅色" : displayMode === "dark" ? "深色" : "跟随系统"} · ${WALLPAPERS.find((w) => w.id === wallpaper)?.label ?? "默认壁纸"}`} onPane={setSettingsPane} onProfile={() => setProfileOpen(true)} /> : null}
          {settingsPane === "menu" ? <StorageHint /> : null}
          {settingsPane === "athlete" ? <><AthletePanel profile={profile} onEdit={() => setProfileOpen(true)} /><SettingsHub only={["p", "n"]} initialOpen="p" onProfile={() => setProfileOpen(true)} onDiet={() => { setSettingsOpen(false); setTab("diet"); }} onBackup={() => setSettingsPane("backup")} /></> : null}
          {settingsPane === "health" ? <><HealthPanel /><SettingsHub only={["h"]} initialOpen="h" onProfile={() => setProfileOpen(true)} onDiet={() => { setSettingsOpen(false); setTab("diet"); }} onBackup={() => setSettingsPane("backup")} /></> : null}
          {settingsPane === "sync" ? <><SyncStatusPanel conn={garminConn} /><div className="-mx-3"><GarminSync hideBackup onState={setGarminConn} /></div><SettingsHub only={["d"]} onProfile={() => setProfileOpen(true)} onDiet={() => { setSettingsOpen(false); setTab("diet"); }} onBackup={() => setSettingsPane("backup")} /></> : null}
          {settingsPane === "import" ? <><section className="home-card mt-3 p-4"><h3 className="font-bold">导入手表文件或截图</h3><p className="mt-1 text-xs text-muted">导入的数据会先给你核对，确认后才保存；与佳明账号同步分开记录来源。</p><DeviceImport today={todayIso} onSaved={() => setHomeRev((v) => v + 1)} /></section><button type="button" onClick={() => { setSettingsOpen(false); setTab("body"); window.setTimeout(() => { const node = document.getElementById("body-records"); if (node instanceof HTMLDetailsElement) node.open = true; document.getElementById("body-devices")?.scrollIntoView({ block: "start" }); }, 40); }} className="home-card mt-3 flex min-h-14 w-full items-center justify-between px-4 text-left text-sm"><span><b className="block">健康页 · 设备记录与说明</b><span className="text-xs text-muted">查看已导入的设备数据和各品牌导入说明</span></span><span aria-hidden="true">›</span></button></> : null}
          {settingsPane === "coach" ? <SettingsHub only={["c", "r"]} initialOpen="c" onProfile={() => setProfileOpen(true)} onDiet={() => { setSettingsOpen(false); setTab("diet"); }} onBackup={() => setSettingsPane("backup")} /> : null}
          {settingsPane === "ai" ? <OnlineFeaturesSettings /> : null}
          {settingsPane === "privacy" ? <><PrivacyPanel /><SettingsHub only={["x"]} onProfile={() => setProfileOpen(true)} onDiet={() => { setSettingsOpen(false); setTab("diet"); }} onBackup={() => setSettingsPane("backup")} /></> : null}
          {settingsPane === "menu" ? null : <button type="button" onClick={() => setSettingsPane("menu")} className="mt-3 min-h-11 text-sm font-bold text-accent">‹ 返回个人与设置</button>}
          {settingsPane === "theme" ? <section id="settings-theme" className="home-card mt-3 p-4" aria-label="界面与壁纸设置">
            <h2 className="font-bold">界面与壁纸</h2>
            
            <div className="mt-3" role="group" aria-label="显示模式">
              <p className="mb-2 text-sm font-bold">显示模式</p>
              <div className="grid grid-cols-3 gap-2">
                {([ ["light", "浅色"], ["dark", "深色"], ["system", "跟随系统"] ] as const).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={displayMode === id}
                    onClick={() => {
                      if (writeDisplayMode(window.localStorage, id)) setDisplayMode(id);
                      else setNotice("显示模式保存失败，其他记录未修改。");
                    }}
                    className={"min-h-11 rounded-card border px-2 text-sm font-bold " + (displayMode === id ? "border-accent bg-bg" : "border-line")}>{label}</button>
                ))}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {WALLPAPERS.map((item) => (
                <button key={item.id} type="button" aria-pressed={wallpaper === item.id} onClick={() => {
                  if (writeWallpaper(localStorage, item.id)) { setWallpaper(item.id); }
                  else { setNotice("壁纸设置未能保存，当前记录不会被修改。"); }
                }} className={"min-h-24 rounded-card border p-2 text-left " + (wallpaper === item.id ? "border-accent ring-2 ring-accent/30" : "border-line")}>
                  <span className={"block h-11 rounded-lg wallpaper-swatch wallpaper-swatch-" + item.id} aria-hidden="true" />
                  <span className="mt-2 block text-sm font-bold">{item.label}</span>
                  <span className="block text-xs text-muted">{item.description}</span>
                </button>
              ))}
            </div>
          </section> : null}
          {settingsPane === "theme" ? <SettingsHub only={["v"]} onProfile={() => setProfileOpen(true)} onDiet={() => { setSettingsOpen(false); setTab("diet"); }} onBackup={() => setSettingsPane("backup")} /> : null}
          {settingsPane === "goals" ? <section id="settings-goals" className="home-card mt-3 p-4 text-sm">
            <h2 className="font-bold">运动项目与目标</h2>
            
            <p className="mt-3 text-xs font-bold text-muted">运动项目</p>
            <div className="mt-2 flex flex-col gap-2">
              {SPORTS.map((item) => (
                <button key={item.id} type="button" aria-pressed={preference.sport === item.id} onClick={() => choosePreference({ ...preference, sport: item.id as SportId })} className={"min-h-11 rounded-card border px-3 text-left font-bold " + (preference.sport === item.id ? "border-accent bg-bg" : "border-line")}>{item.label}</button>
              ))}
            </div>
            <p className="mt-3 text-xs font-bold text-muted">主要目标</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {GOALS.map((item) => (
                <button key={item.id} type="button" aria-pressed={preference.primaryGoal === item.id} aria-label={`主要目标 ${item.label}`} onClick={() => choosePreference({ ...preference, primaryGoal: item.id as GoalId, secondaryGoal: preference.secondaryGoal === item.id ? null : preference.secondaryGoal })} className={"min-h-11 rounded-full border px-3 font-bold " + (preference.primaryGoal === item.id ? "border-accent bg-bg" : "border-line")}>{item.label}</button>
              ))}
            </div>
            <p className="mt-3 text-xs font-bold text-muted">次要目标</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" aria-pressed={preference.secondaryGoal == null} onClick={() => choosePreference({ ...preference, secondaryGoal: null })} className={"min-h-11 rounded-full border px-3 font-bold " + (preference.secondaryGoal == null ? "border-accent bg-bg" : "border-line")}>无</button>
              {GOALS.filter((item) => item.id !== preference.primaryGoal).map((item) => (
                <button key={item.id} type="button" aria-pressed={preference.secondaryGoal === item.id} aria-label={`次要目标 ${item.label}`} onClick={() => choosePreference({ ...preference, secondaryGoal: item.id as GoalId })} className={"min-h-11 rounded-full border px-3 font-bold " + (preference.secondaryGoal === item.id ? "border-accent bg-bg" : "border-line")}>{item.label}</button>
              ))}
            </div>
            <div className="mt-4 border-t border-line pt-3">
              <p className="font-bold">其他并行目标（可多选）</p>
              
              <div className="mt-2 flex flex-wrap gap-2">
                {GOALS.filter((item) => item.id !== preference.primaryGoal).map((item) => {
                  const selected = supportingGoals.includes(item.id as GoalId)
                  return <button key={item.id} type="button" aria-pressed={selected} className={"min-h-11 rounded-full border px-3 font-bold " + (selected ? "border-accent bg-bg" : "border-line")} onClick={() => {
                    const next = selected ? supportingGoals.filter((id) => id !== item.id) : [...supportingGoals, item.id as GoalId]
                    if (saveSupportingGoals(localStorage, next, preference.primaryGoal)) setSupportingGoals(next)
                    else setNotice("并行目标保存失败，原有目标未改变。")
                  }}>{selected ? "✓ " : "+ "}{item.label}</button>
                })}
              </div>
            </div>
            {goalSaveFailed ? <p className="mt-2 text-warn">偏好没有写入本机，原来的记录还在。</p> : <p className="mt-2 text-xs text-muted">当前首页：{variant === "track" ? "田径" : variant === "fat-loss" ? "减脂" : variant === "muscle" ? "增肌 / 力量" : "综合体能"}。刷新后会记住这个选择。</p>}
          </section> : null}
          {settingsPane === "backup" ? <BackupCenter onNotice={setNotice} legacySlot={<div id="settings-backup" className="text-sm"><p className="mt-1 text-xs text-muted">版本 {TRIAL_VERSION}。「全部数据备份」已覆盖这些内容，这里保留给旧流程和大陆静态版。</p>
            <button type="button" className="mt-3 h-12 w-full rounded-card border border-line font-bold" onClick={() => {
              const blob = new Blob([collectLocalBackup(localStorage)], { type: "application/json" })
              const url = URL.createObjectURL(blob)
              const link = document.createElement("a")
              link.href = url
              link.download = "running-strength-backup.json"
              link.click()
              URL.revokeObjectURL(url)
              setNotice("浏览器已开始下载训练记录备份（仅 fr255- 开头的数据，不含模型密钥）。请在“文件/下载”里确认。")
            }}>下载训练记录备份（旧格式）</button>
            <a className="mt-2 flex h-12 w-full items-center justify-center rounded-card border border-line font-bold" href="/running-strength-cn.zip" download="跑步力量-大陆静态版.zip">下载大陆静态网页包</a>
            <label className="mt-2 flex h-12 w-full items-center justify-center rounded-card border border-line font-bold">
              用旧格式文件恢复（训练记录备份）
              <input type="file" accept="application/json" className="sr-only" onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (!file) return
                try {
                  if (file.size > 30_000_000) return setNotice("备份文件超过 30MB，请先核对文件。")
                  const raw = await file.text()
                  const preview = inspectLocalBackup(raw, localStorage)
                  if (!preview.ok) return setNotice(preview.reason)
                  const accepted = window.confirm(`备份日期：${preview.exportedAt ?? "未知"}\n共 ${preview.total} 项：新增 ${preview.added} 项、将覆盖 ${preview.overwritten} 项、相同 ${preview.unchanged} 项。\n\n覆盖可能替换当前记录。请先下载当前备份。确定继续恢复？`)
                  if (!accepted) return setNotice("已取消恢复，当前记录未修改。")
                  const result = restoreLocalBackup(raw, localStorage)
                  if (!result.ok) return setNotice(result.reason)
                  setNotice(`已恢复 ${result.restored} 项。正在重新载入，不会删除备份里没有的项目。`)
                  window.setTimeout(() => window.location.reload(), 400)
                } catch {
                  setNotice("备份没有恢复，原有记录还在。")
                }
              }} />
            </label>
            <button type="button" className="mt-2 min-h-11 w-full rounded-card border border-line" onClick={exportFeedback}>导出反馈记录</button>
          </div>} /> : null}
          {notice ? <p className="mt-3 text-sm">{notice}</p> : null}
        </div>
        </div>
      ) : null}
      <Plan400DayHost today={todayIso} />
      <RunImportPrompt today={todayIso} />
      {true ? <QuickLog hideFab openWith={quickOpen} today={todayIso} onSaved={() => setHomeRev((v) => v + 1)} onFile={() => { setBodyPane("device"); setTab("body"); }} /> : null}
      {editHome ? <HomeEditor layout={homeLayout} onChange={setHomeLayout} onClose={() => setEditHome(false)} /> : null}
      {healthLink ? <HealthLinkSheet text={healthLink} onClose={() => { setHealthLink(null); setHomeRev((v) => v + 1); }} /> : null}
      {firstRun ? <Onboarding today={todayIso} onDone={() => { setFirstRun(false); setHomeRev((v) => v + 1); }} /> : null}
      <ChromeMetrics />
      <nav className={"ui03-dock dock fixed inset-x-0 bottom-0 z-20" + (tab === "coach" ? " hidden" : "")} aria-label="主导航">
        <div className="ui03-dock-inner mx-auto grid max-w-3xl grid-cols-6">
          {(
            [
              ["today", "今日", House],
              ["plan", "计划", ClipboardList],
              ["coach", "方坤", MessageCircle],
              ["diet", "饮食", Utensils],
              ["log", "日志", CalendarDays],
              ["body", "健康", Scale],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => { if (id === "coach" && tab !== "coach") { prevTab.current = tab; setCoachLink("ask"); setCoachFocus(null); } setTab(id); }}
              aria-label={`切换到${label}`}
              aria-current={tab === id ? "page" : undefined}
              className={"ui03-tab flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-bold " + "" + (tab === id ? "ui03-tab-active text-accent" : "text-muted")}
            >
              <span className={"ui03-tab-icon grid h-8 min-w-12 place-items-center rounded-2xl " + (tab === id ? "stat-run" : "")}><Icon className="size-5" strokeWidth={tab === id ? 2.4 : 2} /></span>
              <span className="ui03-tab-label">{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {picker ? (
        <Sheet title="选动作" onClose={() => setPicker(false)}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜深蹲、划船、平板…"
            className="h-12 w-full rounded-card border border-line bg-surface px-3 outline-none"
          />
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {(["全部", ...GROUPS] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setGroup(item)}
                className={"h-11 shrink-0 rounded-full px-3 text-sm " + (group === item ? "bg-accent font-bold text-accent-fg" : "bg-surface text-muted")}
              >
                {item}
              </button>
            ))}
          </div>
          {query.trim() ? (
            <button
              type="button"
              onClick={() => {
                if (!session) return;
                updateSession({ moves: [...session.moves, customMove(query)] });
                setPicker(false);
              }}
              className="mt-3 flex h-12 w-full items-center justify-between rounded-card bg-surface-2 px-3 text-left"
            >
              <span>
                用自定义名称
                <span className="mt-0.5 block text-xs text-muted">表上显示你写的字，没有官方动画</span>
              </span>
              <span className="font-bold">{query.trim()}</span>
            </button>
          ) : null}
          <ul className="mt-3 flex flex-col gap-2">
            {filtered.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!session) return;
                    updateSession({ moves: [...session.moves, moveFromCatalog(item)] });
                    setPicker(false);
                  }}
                  className="flex h-14 w-full items-center justify-between rounded-card bg-surface px-3 text-left"
                >
                  <span className="font-bold">{item.name}</span>
                  <span className="text-sm text-muted">{item.group}</span>
                </button>
              </li>
            ))}
          </ul>
          {filtered.length === 0 ? <p className="mt-6 text-center text-sm text-muted">没有这个官方动作，可以用上面的自定义名称。</p> : null}
        </Sheet>
      ) : null}

      {feedback && session ? (
        <Sheet title="训练反馈" onClose={() => setFeedback(false)}>
          <div className="rounded-card border border-line bg-surface-2 p-3">
            <p className="text-xs font-bold text-muted">正在记录</p>
            <p className="mt-1 text-base font-bold">{session.name}</p>
            
          </div>
          <fieldset className="mt-4">
            <legend className="text-sm font-bold">1. 这节练得怎么样？</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {FEELS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={feel === item.id}
                  onClick={() => setFeel(item.id)}
                  className={"min-h-16 rounded-card border px-3 py-2 text-left transition-colors " + (feel === item.id ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface") + (item.id === "skip" ? " col-span-2" : "")}
                >
                  <span className="block font-bold">{item.label}</span>
                  <span className={"mt-0.5 block text-xs " + (feel === item.id ? "text-accent-fg" : "text-muted")}>{item.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
          {feel === "pain" ? (
            <fieldset className="mt-4 rounded-card border border-line p-3">
              <legend className="px-1 text-sm font-bold">2. 哪个动作不舒服？</legend>
              
              <div className="flex flex-wrap gap-2">
                {session.moves.map((move) => {
                  const on = painIds.includes(move.id);
                  return (
                    <button
                      key={move.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPainIds((current) => (current.includes(move.id) ? current.filter((id) => id !== move.id) : [...current, move.id]))}
                      className={"min-h-11 rounded-full border px-3 py-2 text-sm " + (on ? "border-accent bg-accent font-bold text-accent-fg" : "border-line bg-surface")}
                    >
                      {on ? "✓ " : ""}{displayName(move)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
          <details className="mt-4 rounded-card border border-line px-3">
            <summary className="flex min-h-12 cursor-pointer items-center text-sm font-bold">{feelNote ? "补充说明（已填写）" : "补充说明（可选）"}</summary>
            <label className="block pb-3 text-sm text-muted" htmlFor="feel-note">
              想记录疼痛位置、主观状态或训练感受，可以写在这里。
              <textarea
                id="feel-note"
                value={feelNote}
                maxLength={80}
                rows={2}
                onChange={(event) => setFeelNote(event.target.value)}
                placeholder="例如：左膝弯曲时不舒服"
                className="mt-2 w-full resize-y rounded-card border border-line bg-surface px-3 py-2 text-base text-fg outline-none"
              />
              <span className="mt-1 block text-right text-xs">{feelNote.length}/80</span>
            </label>
          </details>
          
          <button
            type="button"
            onClick={() => {
              setPlan(logSession(plan, session.id, feel, painIds, feelNote));
              const coachOk = saveCoach(absorbFeel(loadCoach(), session.name, feel, feelNote));
              setFeedback(false);
              const left = plan.sessions.filter((item) => item.id !== session.id && !plan.cycle?.logs.some((log) => log.sessionId === item.id)).length;
              setNotice(coachOk ? (left === 0 ? "记下了，教练也看到了。这周可以生成下一周。" : `记下了，教练也看到了。还差 ${left} 节。`) : COACH_SAVE_FAIL);
            }}
            className="mt-3 flex min-h-12 w-full items-center justify-center rounded-card bg-accent px-3 font-bold text-accent-fg"
          >
            {plan.cycle?.logs.some((log) => log.sessionId === session.id) ? "保存反馈修改" : "确认并保存反馈"}
          </button>
        </Sheet>
      ) : null}

      {builderOpen ? <Sheet title="组合课程草稿" onClose={()=>{if(!builderSaving.current)setBuilderOpen(false);}}><SessionBuilder onCancel={()=>{if(!builderSaving.current)setBuilderOpen(false);}} onConfirm={async draft=>{
        if(!navigator.locks?.request)return {ok:false,reason:"浏览器不支持写入锁，草稿保留。"};
        builderSaving.current=true;
        try { return await navigator.locks.request(PLAN_KEY,()=>{
          const result=appendSessionCompared(localStorage,planRaw.current,plan,draft);
          if(!result.ok)return result;
          planRaw.current=result.raw;setPlan(result.plan);setActive(result.plan.sessions.length-1);setBuilderOpen(false);setNotice(`已保存一节组合课：${draft.name}。尚未执行。`);return {ok:true};
        }); } finally {builderSaving.current=false;}
      }} /></Sheet> : null}
      {muscleOpen ? <MuscleExplorerSheet onClose={() => setMuscleOpen(false)} onShow={setMuscleDemo} onAdd={action => { setMuscleOpen(false); setTrainingEditor({ date: selectedDate, seedAction: action }); }} /> : null}
      {trainingEditor ? <TrainingEditorSheet templates={plan} key={`${trainingEditor.date}:${trainingEditor.initial?.id ?? trainingEditor.template?.id ?? 'new-training'}`} {...trainingEditor} onClose={() => setTrainingEditor(null)} onSave={async entry => { const result = await saveScheduledEntry(entry, trainingEditor.initial); if (result.ok) { setCalendar(loadSchedule().entries); setSelectedDate(entry.date); setHomeRev(n => n + 1); } return result; }} /> : null}
      {timerPicker ? <SchedulePicker date={selectedDate} onClose={() => setTimerPicker(false)} onChoose={openScheduled} onAdd={() => { setTimerPicker(false); setTrainingEditor({ date: selectedDate }); }} /> : null}
      {executionEntryId && calendar.find(e => e.id === executionEntryId) ? <ScheduledTraining key={executionEntryId} entry={calendar.find(e => e.id === executionEntryId)!} plan={plan} onClose={() => setExecutionEntryId(null)} onEdit={() => { const entry = calendar.find(e => e.id === executionEntryId)!; setExecutionEntryId(null); editScheduled(entry); }} onChanged={() => { setCalendar(loadSchedule().entries); setHomeRev(n => n + 1); }} onResumeOther={id => { setExecutionEntryId(null); resumeSession(id); }} /> : null}
      {actionLibrary ? <AppSheet full title="力量动作库" label="力量动作库" onClose={() => setActionLibrary(false)} footer={<button type="button" className="min-h-12 w-full rounded-xl border border-line" onClick={() => setActionLibrary(false)}>完成查看</button>}><MuscleActionList pick={null} onShow={setMuscleDemo} onAdd={action => { setActionLibrary(false); setTrainingEditor({ date: selectedDate, seedAction: action }); }} /></AppSheet> : null}
      {techniqueLibrary ? <AppSheet full title="跑步技术动作库" label="跑步技术动作库" onClose={() => setTechniqueLibrary(false)} footer={null}><Suspense fallback={<p>正在加载跑步技术…</p>}><RunningTechniqueLibrary/></Suspense></AppSheet> : null}
      {muscleDemo ? <DemoSheet id={muscleDemo} onClose={() => setMuscleDemo(null)} /> : null}
      {formMove ? <Sheet title={displayName(formMove)} onClose={()=>setFormMove(null)}><ExerciseContent catalogId={formMove.catalogId} /></Sheet> : null}

      {profileOpen ? (
        <ProfileSheet
          initial={withCoachGoals(profile, loadCoach().goals)}
          onClose={() => setProfileOpen(false)}
          onSave={(next) => {
            saveProfile(next);
            setProfile(next);
            const memory = loadCoach();
            const goals = goalsFromProfile(next);
            const managed = new Set(next.marks.map((mark) => mark.meters));
            const rest = memory.goals.filter((goal) => !managed.has(goal.meters));
            const coachOk = saveCoach({ ...memory, minutes: next.minutes, goals: [...goals, ...rest] });
            setProfileOpen(false);
            setNotice(coachOk ? "个人情况已保存。教练会按这些目标和晚上的时间看。" : COACH_SAVE_FAIL);
          }}
        />
      ) : null}
      {trainingImportOpen ? <TrainingImportSheet onClose={() => setTrainingImportOpen(false)} /> : null}
      {coachPlanOpen ? <CoachPlanSheet profile={profile} onEditProfile={() => { setCoachPlanOpen(false); setProfileOpen(true); }} onClose={() => setCoachPlanOpen(false)} /> : null}

    </div>
  );
}

function CycleCard({ plan, onAdvance }: { plan: Plan; onAdvance: () => void }) {
  const cycle = plan.cycle ?? { block: 1, week: 1 as const, logs: [], lastChange: "" };
  const phase = phaseOf(cycle.week);
  const required = cycle.week === 4 && plan.sessions.length > 2 ? plan.sessions.slice(0, -1) : plan.sessions;
  const done = required.filter((item) => cycle.logs.some((log) => log.sessionId === item.id)).length;
  const total = required.length;
  const ready = weekReady(plan);
  return (
    <div className="mt-4">
      <p className="text-sm font-bold">当前周期</p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className="text-sm">{cycle.week === 4 ? `第 ${cycle.block} 周期 · 调整` : `第 ${cycle.week} / 4 周`}</p>
        <p className="text-sm text-accent">{phase.label}</p>
      </div>
      <div className="mt-2 flex gap-1" aria-hidden="true">
        {PHASES.map((item) => (
          <span key={item.week} className={"h-1.5 flex-1 rounded-full " + (item.week <= cycle.week ? "bg-accent" : "bg-line")} />
        ))}
      </div>
      <p className="mt-2 text-sm text-muted">{phase.note}</p>
      {cycle.bias === "hold" ? <p className="text-sm">下周先不加量。</p> : null}
      {cycle.bias === "deload" ? <p className="text-sm">下周少一组，主项留下。</p> : null}
      <p className="text-sm text-muted">本周反馈 {done}/{total}{ready ? "，可以进入下一步。" : "。练完记一下感觉。"}</p>
      {cycle.lastChange ? <p className="mt-1 text-sm">{cycle.lastChange}</p> : null}
      <button
        type="button"
        onClick={onAdvance}
        disabled={!ready}
        className={"mt-3 flex h-11 w-full items-center justify-center rounded-2xl text-sm font-bold " + (ready ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}
      >
        {ready ? (cycle.week === 3 ? "进入 3–4 天调整" : cycle.week === 4 ? "开始下一个三周" : "按反馈生成下一周") : "先把这周的感觉记全"}
      </button>
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="min-w-0 truncate text-lg font-bold">{title}</h2>
        <button type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center" aria-label="关闭">
          <X className="size-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className={"grid size-11 place-items-center " + (disabled ? "text-muted/40" : "text-muted")}>
      {children}
    </button>
  );
}

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className={"h-11 rounded-full px-3 text-sm font-bold " + (pressed ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}>
      {children}
    </button>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const shown = Number.isInteger(value) ? String(value) : String(value);
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-2">
      <p className="px-1 text-xs text-muted">{label}</p>
      <div className="mt-1 flex items-center justify-between">
        <button
          type="button"
          disabled={value <= min}
          className="grid size-11 place-items-center rounded-full bg-surface text-lg disabled:opacity-30"
          aria-label={`减少${label}`}
          onClick={() => onChange(round(Math.max(min, value - step)))}
        >
          −
        </button>
        <span className="text-sm font-bold">
          {shown}
          {suffix ? <span className="ml-0.5 text-xs font-medium text-muted">{suffix}</span> : null}
        </span>
        <button
          type="button"
          disabled={value >= max}
          className="grid size-11 place-items-center rounded-full bg-surface text-lg disabled:opacity-30"
          aria-label={`增加${label}`}
          onClick={() => onChange(round(Math.min(max, value + step)))}
        >
          +
        </button>
      </div>
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 2) / 2;
}

function StandaloneWelcome() {
  const [show, setShow] = useState(false), [msg, setMsg] = useState("");
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i) ?? ""; if (/^(fr255-(food|body|plan|schedule)|fk-(plan400|garmin-acts|bodylab))/.test(k)) n++; }
    if (standalone && n === 0 && !localStorage.getItem("fk-welcome-standalone-v1")) setShow(true);
  }, []);
  if (!show) return null;
  const done = () => { localStorage.setItem("fk-welcome-standalone-v1", "1"); setShow(false); };
  return <div className="fixed inset-0 z-[60] overflow-y-auto bg-bg p-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }} role="dialog" aria-label="欢迎">
    <h2 className="text-xl font-bold">欢迎使用主屏幕版方坤</h2>
    <p className="keep mt-1 text-sm text-muted">主屏幕版和 Safari 版的数据是分开存的。</p>
    <section className="fk-dash-card mt-3 p-3">
      <b>从 Safari 版迁移数据</b>
      <ol className="keep mt-1 list-decimal pl-5 text-xs text-muted"><li>在 Safari 打开方坤 → ⚙️ → 全部数据备份 → 一键导出 → 存储到「文件」</li><li>回到这里，点下面按钮选那个备份文件</li></ol>
      <label className="fk-orange-btn mt-2 flex min-h-11 cursor-pointer items-center justify-center rounded-xl font-bold">选择备份文件导入<input type="file" accept="application/json,.json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const n = await importVault(f); localStorage.setItem("fk-welcome-standalone-v1", "1"); setMsg(`已恢复 ${n} 项，正在刷新`); setTimeout(() => location.reload(), 800); } catch (err) { setMsg((err as Error).message); } }} /></label>
      {msg ? <p className="keep mt-1 text-xs" aria-live="polite">{msg}</p> : null}
    </section>
    <div className="-mx-3 mt-3"><GarminSync /></div>
    <button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-line text-sm" onClick={done}>跳过，从头开始</button>
  </div>;
}

function StorageHint() {
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(!localStorage.getItem("fk-storage-hint-v1")); }, []);
  if (!show) return null;
  return <section className="home-card mt-3 p-3 text-sm" aria-label="存储提示"><b>Safari 和主屏幕 App 的数据是分开的</b><p className="keep mt-1 text-xs text-muted">在 Safari 里记的数据，添加到主屏幕后不会自动出现。先在原来那边「全部数据备份 → 导出」，再到另一边「导入恢复」。</p><button type="button" className="fk-link mt-1 text-xs" onClick={() => { localStorage.setItem("fk-storage-hint-v1", "1"); setShow(false); }}>知道了</button></section>;
}

function ChromeMetrics() {
  useEffect(() => {
    const root = document.documentElement; const nav = document.querySelector<HTMLElement>(".ui03-dock");
    const navH = () => { const h = nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().height : 0; root.style.setProperty("--fk-nav-h", `${Math.round(h)}px`); };
    const kb = () => { const vv = window.visualViewport; const ae = document.activeElement as HTMLElement | null; const typing = !!ae && (ae.tagName === "INPUT" && !["range", "checkbox", "radio", "button", "file"].includes((ae as HTMLInputElement).type) || ae.tagName === "TEXTAREA" || ae.isContentEditable); root.classList.toggle("fk-kb", typing || (!!vv && vv.height < window.innerHeight * 0.75)); if (vv) { root.style.setProperty("--fk-kb-h", `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`); root.style.setProperty("--fk-vvh", `${Math.round(vv.height)}px`); } };
    window.visualViewport?.addEventListener("scroll", kb);
    const sheet = () => root.classList.toggle("fk-sheet", !!document.querySelector('[role="dialog"]'));
    const ro = nav ? new ResizeObserver(navH) : null; if (nav && ro) ro.observe(nav);
    const mo = new MutationObserver(() => { sheet(); navH(); }); mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    navH(); sheet(); kb();
    window.visualViewport?.addEventListener("resize", kb); document.addEventListener("focusin", kb); document.addEventListener("focusout", () => setTimeout(kb, 50)); window.addEventListener("resize", navH);
    return () => { ro?.disconnect(); mo.disconnect(); window.visualViewport?.removeEventListener("resize", kb); document.removeEventListener("focusin", kb); window.removeEventListener("resize", navH); };
  }, []);
  return null;
}

installChunkRecovery();
