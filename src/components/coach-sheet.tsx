import {explicitlyReviewsRecord} from '@/lib/core/coach-specialty-analysis'
import { CoachAnswerView } from "@/components/coach-answer-view";
import { CoachIntegrationPanel } from '@/components/coach-integration-panel';
import { CoachPlanChangePanel } from '@/components/coach-plan-change-panel';
import { CoachC03FollowupPanel } from '@/components/coach-c03-followup-panel';
import { registerDisplayedC03Review } from '@/lib/coach/c03/runtime';
import type { LocalCoachAnswer } from '@/lib/core/coach-local-first';
import { readCoachMemory } from '@/lib/core/coach-context-memory';
import { detectRedFlags } from '@/lib/core/coach-red-flags';
import { CoachChatLoadPanel } from '@/components/coach-chat-load-panel';
import { CoachChatTrainingPanel } from '@/components/coach-chat-training-panel';
import { emptyDialogue } from '@/lib/core/coach-dialogue';
import {commitDisplayedCoachAdvice} from '@/lib/core/coach-p7-runtime';
import type { ChatTraining } from '@/lib/core/coach-chat-evidence';
import { chatLoadPreview } from '@/lib/core/coach-chat-load';
import { readCoachReviewWorkspace } from '@/lib/core/coach-review-workspace';
import { calendarDay } from '@/lib/core/coach-calendar';
import { occurrenceVoided } from '@/lib/core/training-correction';
import { confirmImportedSessionRpe } from '@/lib/core/coach-import-rating';
import { reportedSessionRpes } from '@/lib/core/coach-claim-scope';
import { formatComputedFacts } from '@/lib/core/coach-reasoning';
import { listConfirmedDeviceEvidence } from "@/lib/core/device-evidence-idb";
import { CoachAnswerFeedbackForm } from "@/components/coach-answer-feedback";
import { attachLinkedSources, deviceCoachSources } from "@/lib/core/coach-linked-context";
import { coachImports } from "@/lib/core/coach-import-evidence";
import { LearningLibrary } from "@/components/learning-library";
import { CoachCognitionPanel } from "@/components/coach-cognition-panel";
import { CoachFirstWeekPanel } from '@/components/coach-first-week-panel';
import { CoachLoadMetricsPanel } from '@/components/coach-load-metrics-panel';
import { firstWeekGoalFromText } from '@/lib/core/coach-first-week';
import type { CoachCognition } from "@/lib/core/coach-cognition";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Send, X } from "lucide-react";
import { FangShen, type FangFace } from "@/components/fang-shen";
import { executeDecision, loadDecisions, recordOverride, rejectDecision } from "@/lib/core";
import { RunningRoundReadout } from "@/components/running-round-readout";
import { DeviceEvidenceImport } from "@/components/device-evidence-import";
import { CoachStrengthEditPanel, type CoachStrengthAction } from "@/components/coach-strength-edit-panel";
import { CoachStatusCard, DecisionCard, DecisionInbox, SessionReview, TodayState } from "@/components/coach-panels";
import { acceptIssued, issueTrainingDecision, overrideIssued, rejectIssued } from "@/lib/core/brain-loop";
import { abilityRows, competitionView, latestReviewableCompletion, limiterFrom, sessionFromCompleted, toneFor, trendText } from "@/lib/core/coach-view";
import { readCoachOpenView } from "@/lib/core/coach-open";
import { loadEvents, onAppEvent } from "@/lib/core/events";
import { appendCoachNotice, noticeForCoachEvent, type CoachActivityNotice } from "@/lib/core/coach-activity-watch";
import { chooseAction, createTrainingDecision, firstPlannedSet, readTrainingContext } from "@/lib/core/training-decision";
import { refreshAthleteState } from "@/lib/core/state";
import type { AthleteState, DecisionRecord } from "@/lib/core/types";
import { fatigueLabel } from "@/lib/strength/agent";
import { askCoach } from "@/lib/strength/coach-ai";
import { currentAthleteId } from "@/lib/core/events";
import { readFormalEvidenceRows } from "@/lib/core/coach-v4-formal-rows-store";
import { buildCoachModelRequest, normalizeAskCoachInput, normalizeV4 } from '@/lib/strength/coach-pipeline';
import { latestReasoningBasis, reasoningReadFailure } from '@/lib/core/coach-reasoning';
import { answerLocally, answerStaysLocal } from "@/lib/core/coach-local-first";
import { loadInstalledKnowledgeLedger, KNOWLEDGE_APPROVALS_KEY } from "@/lib/coach/knowledge/approval-store";
import { subscribeKnowledgeLedger } from "@/lib/coach/knowledge/approval";
import { reviewKnowledgeJudgments } from "@/lib/coach/knowledge/history";
import { isNativeRecordInspection } from '@/lib/core/dialogue-e1';
import { offlineCapability, localModelFallback, type CoachFailure } from "@/lib/core/coach-offline";
import { saveOfflineReview } from "@/lib/core/coach-offline-loop";
import { CoachOfflineLoopPanel } from "@/components/coach-offline-loop-panel";
import { COACH_NETWORK_MODE_KEY, COACH_PUBLIC_REFERENCES, authorizeNetworkAction, parseCoachNetworkMode, type CoachNetworkMode } from "@/lib/core/coach-network-policy";
import { PERSONAS, PERSONA_KEY, parsePersona, presentCoachAnswer, type CoachPersona } from "@/lib/core/coach-persona";
import { extractConversationContext, contextualFollowup } from "@/lib/core/coach-conversation-context";
import { assembleCoachBrief, recordCoachBodyEvidence, recordCoachChoice, recordCoachEvidence, type CoachBrief } from "@/lib/core/coach-brief";
import { formatTrainingWhen, listBoundTrainings, orderOccurrenceIds, sameCalendarDay, separateBriefs } from "@/lib/core/coach-compare";
import { assembleCoachSeries, toggleSeriesId } from "@/lib/core/coach-series";
import { listTrainingOccurrences } from "@/lib/core/occurrence";
import type { CoachFuel } from "@/lib/core/coach-fuel";
import { COACH_CHIPS, loadCoach, saveCoach, type CoachMemory } from "@/lib/strength/coach";
import type { Plan } from "@/lib/strength/model";
import { isReviewAsk, pickDefaultActivity, reviewActivity, intervalRestAnswer, localDayOf, type GActivity, type GLap } from "@/lib/coach/plain-coach";
import { onlineSetting, setOnline as persistOnline, garminActivities, cachedLaps, saveLaps, buildFacts, askOnlineCoach } from "@/lib/coach/online-coach";
import { fetchLaps } from "@/components/garmin-log";
import { activityLocalDay, fmtDistance } from "@/lib/ui/activity-format";

function latestSessionRpe(events: { event_type: string; payload: Record<string, unknown> }[]): number | null {
  for (const event of [...events].reverse()) {
    if (event.event_type !== "RPE_RECORDED") continue
    const payload = event.payload
    if (payload.evidenceType === "SUBJECTIVE_RECOVERY") continue
    const session = payload.evidenceType === "SESSION_RPE" ? payload.value : typeof payload.rpe === "number" ? payload.rpe : null
    if (payload.evidenceType !== "SESSION_RPE" && typeof payload.rpe !== "number") continue
    if (typeof session === "number" && Number.isInteger(session) && session >= 1 && session <= 10) return session
  }
  return null
}

export function CoachSheet({
  plan,
  activeId,
  onClose,
  onJump,
  embedded = false,
  focusOccurrenceId = null,
  link = "ask",
  onControlledStrengthEdit,
  coordinationPanel,
  onNavigate,
  questionDraft,
  onQuestionDraftConsumed,
}: {
  plan: Plan;
  activeId?: string;
  onClose: () => void;
  onJump?: (tab: "body") => void;
  embedded?: boolean;
  focusOccurrenceId?: string | null;
  link?: "ask" | "bound" | "unbound";
  onControlledStrengthEdit?: CoachStrengthAction;
  coordinationPanel?: ReactNode;
  onNavigate?: (tab: "plan" | "body" | "log") => void;
  questionDraft?: string | null;
  onQuestionDraftConsumed?: () => void;
}) {
  const [section, setSection] = useState<"chat" | "learn" | "review">("chat");
  const [cognitionTurn, setCognitionTurn] = useState<{cognition: CoachCognition; brief: CoachBrief} | null>(null);
  const [firstWeekGoalState,setFirstWeekGoalState]=useState<{ athleteId: string; value: ReturnType<typeof firstWeekGoalFromText> } | null>(null);
  const athleteScope = currentAthleteId();
  const firstWeekGoal = firstWeekGoalState?.athleteId === athleteScope ? firstWeekGoalState.value : null;
  const [storedMemory, setMemory] = useState<CoachMemory | null>(null);
  const memory = storedMemory?.athleteId === athleteScope ? storedMemory : null;
  const [persona, setPersona] = useState<CoachPersona>("balanced");
  const [athlete, setAthlete] = useState<AthleteState | null>(null);
  const [pending, setPending] = useState<DecisionRecord | null>(null);
  const [inbox, setInbox] = useState<DecisionRecord | null>(null);
  const [completedDecisionId, setCompletedDecisionId] = useState<string | null>(null);
  const [change, setChange] = useState("");
  const [coachSaveFailed, setCoachSaveFailed] = useState(false)
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  useEffect(()=>{if(questionDraft){setSection('chat');setDraft(questionDraft);onQuestionDraftConsumed?.()}},[questionDraft]);
  // v87：载入本机受信知识回执并重新验证（生产没有受信审核人 → 0 批准）。
  const [knowledgeLedgerAt, setKnowledgeLedgerAt] = useState(0);
  useEffect(()=>{
    const unsubscribe = subscribeKnowledgeLedger(()=>setKnowledgeLedgerAt(n=>n+1));
    const reload = ()=>{void loadInstalledKnowledgeLedger().catch(()=>{})};
    const onStorage = (event: StorageEvent)=>{if(event.key === null || event.key === KNOWLEDGE_APPROVALS_KEY) reload()};
    window.addEventListener('storage', onStorage);
    reload();
    return ()=>{unsubscribe();window.removeEventListener('storage', onStorage)};
  },[]);
  const [sending, setSending] = useState(false);
  const [onlineRequest, setOnlineRequest] = useState<string | null>(null);
  const [activityNotices, setActivityNotices] = useState<CoachActivityNotice[]>([]);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [networkMode, setNetworkMode] = useState<CoachNetworkMode>("local");
  const [onlineOn, setOnlineOn] = useState(() => onlineSetting().on);
  const autoLinkedRef = useRef<string | null>(null);
  const [recordRevision, setRecordRevision] = useState(0);
  const [chatLoad, setChatLoad] = useState<{question:string;id:string;occurrenceId:string|null}|null>(null);
  const [chatTraining,setChatTraining]=useState<ChatTraining|null>(null);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [turnQuestion, setTurnQuestion] = useState("");
  const [choiceNote, setChoiceNote] = useState("");
  const [occurrences, setOccurrences] = useState<ReturnType<typeof listTrainingOccurrences>>([]);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | null>(null);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [seriesIds, setSeriesIds] = useState<string[]>([]);
  const [rpeDraft, setRpeDraft] = useState("");
  const [recoveryDraft, setRecoveryDraft] = useState("");
  const [bodyKind, setBodyKind] = useState<"SORENESS" | "PAIN">("SORENESS");
  const [bodyLocation, setBodyLocation] = useState("");
  const [bodyIntensity, setBodyIntensity] = useState("");
  const [face, setFace] = useState<FangFace>("happy");
  const [motion, setMotion] = useState(true);
  const [retryQuestion, setRetryQuestion] = useState<string | null>(null);
  const [fuelPreview, setFuelPreview] = useState<CoachFuel | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const memoryLoaded = useRef(false);
  const pendingC03 = useRef<{ answer: LocalCoachAnswer; athleteId: string; messageId: string } | null>(null);

  useEffect(() => {
    memoryLoaded.current = false;
    pendingC03.current = null;
    setFirstWeekGoalState(null);
    setCognitionTurn(null);
    setActivityNotices([]);
    setChatLoad(null); setChatTraining(null);
    setCompareA(''); setCompareB(''); setSeriesIds([]);
    setRpeDraft(''); setRecoveryDraft(''); setBodyLocation(''); setBodyIntensity('');
    setSending(false);
    setOnlineRequest(null);
    setMemory(loadCoach());
    try { setNetworkMode(parseCoachNetworkMode(window.localStorage.getItem(COACH_NETWORK_MODE_KEY))); } catch { /* storage unavailable */ }
    try { setPersona(parsePersona(window.localStorage.getItem(PERSONA_KEY))); } catch { /* storage unavailable */ }
    const starts = loadEvents().filter((event) => event.event_type === "TRAINING_STARTED");
    const available = listTrainingOccurrences().filter((item) => starts.some((event) => event.event_id === item.startEventId));
    setOccurrences(available);
    setSelectedOccurrenceId(available.length === 1 ? available[0].trainingOccurrenceId : null);
    setMotion(window.localStorage.getItem("fr255-fangshen-motion") !== "off");
    try {
      const view = readCoachOpenView();
      setAthlete(view.athlete);
      setPending(view.pending);
      setInbox(view.inbox);
      setCompletedDecisionId(view.completedDecisionId);
    } catch {
      /* 状态算不出来也要能聊天 */
    }
  }, []);

  useEffect(() => {
    // Connectivity is informative only: all basic coach functions remain local.
    const refresh = () => setIsOnline(window.navigator.onLine);
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, []);

  useEffect(() => onAppEvent(event => {
    if (event.athlete_id !== currentAthleteId()) return;
    setActivityNotices(current => appendCoachNotice(current, noticeForCoachEvent(event)));
    setRecordRevision(value => value + 1);
    // Do not silently bind new events to a prior session.
    const starts = loadEvents().filter(item => item.event_type === "TRAINING_STARTED");
    const available = listTrainingOccurrences().filter(item => starts.some(start => start.event_id === item.startEventId));
    setOccurrences(available);
  }), []);

  useEffect(() => {
    if (link === "unbound") {
      setSelectedOccurrenceId(null)
      return
    }
    if (link !== "bound") return
    setSelectedOccurrenceId(focusOccurrenceId && listBoundTrainings().some((item) => item.trainingOccurrenceId === focusOccurrenceId) ? focusOccurrenceId : null)
  }, [link, focusOccurrenceId, occurrences]);

  useEffect(() => {
    if (!memory) return;
    if (!memoryLoaded.current) { memoryLoaded.current = true; return; }
    const saved = saveCoach(memory);
    setCoachSaveFailed(!saved);
    const review = pendingC03.current;
    if (saved && review && memory.athleteId === review.athleteId && currentAthleteId() === review.athleteId && memory.messages.some(m => m.id === review.messageId)) {
      pendingC03.current = null;
      void registerDisplayedC03Review(review.answer).then(result => {
        if (!result.ok && currentAthleteId() === review.athleteId) setNotice('回答已保留，但长期观察依据尚未保存；原训练记录未改变。');
      }).catch(() => { if (currentAthleteId() === review.athleteId) setNotice('长期观察待重试；原训练记录和回答仍保留。'); });
    }
  }, [memory]);

  useEffect(() => {
    setFuelPreview(selectedOccurrenceId ? assembleCoachBrief(plan, "查看当天热量", selectedOccurrenceId).fuel ?? null : null);
  }, [plan, selectedOccurrenceId, recordRevision]);

  // v87：引用过知识卡的旧回答，卡/来源哈希、版本或批准变化后标“需复核”（复用 C03 依赖比较器）。
  const knowledgeReview = useMemo(() => { const m = new Map<string, boolean>(); if (!memory) return m; try { for (const r of reviewKnowledgeJudgments(memory.messages, { athleteId: athleteScope, asOf: Date.now() })) if (r.state === 'NEEDS_REVIEW') m.set(r.messageId, true) } catch { /* 复核失败不隐藏原回答 */ } return m }, [memory, athleteScope, knowledgeLedgerAt]);
  const screen = useMemo(() => {
    if (!athlete) return null;
    const session = plan.sessions.find((item) => item.id === activeId) ?? plan.sessions[0] ?? null;
    const planned = firstPlannedSet(session);
    const decision = planned ? createTrainingDecision(readTrainingContext(plan), planned) : null;
    const last = latestReviewableCompletion(loadEvents());
    const review = last ? sessionFromCompleted(last.payload as Record<string, unknown>, athlete.recovery.fatigueScore) : null;
    const evidence = loadEvents().filter((event) => event.event_type === "TRAINING_COMPLETED").length;
    return { session, planned, decision, review, rows: abilityRows(athlete.ability, evidence, null) };
  }, [athlete, plan, activeId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [memory?.messages.length]);

  async function send(text: string, retry = false, useCloud = false) {
    const value = text.trim();
    if (!value || !memory || sending) return;
    // Local capability is evaluated before the optional, explicitly requested model route.
    const capable=offlineCapability(value);
    const authorized=authorizeNetworkAction({ mode: networkMode, action: "invoke-paid-model", online: isOnline ?? undefined, explicitDataConsent: useCloud, serverAuthorized: false }).allowed;
    const cloudRequested=useCloud;
    useCloud=useCloud&&!capable.independent&&authorized&&isOnline!==false;
    if(cloudRequested&&!useCloud)setNotice(capable.independent?"本题可直接使用本地分析。":isOnline===false?"当前离线，已使用本地分析。":"模型尚未授权，已使用本地分析；没有上传训练或健康数据。");
    // 复盘类问题：用户没手动选训练、也没选“不绑定”时，默认关联最近一次（或问到的那天）佳明活动。
    const today = localDayOf(new Date().toISOString());
    const reviewAsk = isReviewAsk(value) && link !== "unbound";
    let linkedAct: GActivity | null = null, linkedLaps: GLap[] | null = null, effectiveSelected = selectedOccurrenceId, linkNotice = "";
    if (reviewAsk) {
      const acts = garminActivities();
      const manual = selectedOccurrenceId && selectedOccurrenceId !== autoLinkedRef.current ? selectedOccurrenceId : null;
      const chosen = manual ? coachImports().find(i => i.confirmedImportId === selectedOccurrenceId) : null;
      linkedAct = chosen ? (chosen.sourceRecordIdentity ? acts.find(a => a.sourceIdentity === chosen.sourceRecordIdentity) ?? null : null) : manual ? null : pickDefaultActivity(value, acts, today);
      if (linkedAct && !manual) {
        const imp = coachImports().find(i => i.sourceRecordIdentity && i.sourceRecordIdentity === linkedAct!.sourceIdentity);
        if (imp) { effectiveSelected = imp.confirmedImportId; autoLinkedRef.current = imp.confirmedImportId; setSelectedOccurrenceId(imp.confirmedImportId); }
        linkNotice = (`已默认关联最近一次训练：${(activityLocalDay(linkedAct.start) ?? '').slice(5)} ${linkedAct.name || linkedAct.type}${linkedAct.dist ? ` ${fmtDistance(linkedAct.dist)}` : ""}（可在下方“本次问答关联训练”改选）`); setNotice(linkNotice);
      }
      if (linkedAct) { linkedLaps = cachedLaps(linkedAct.id); if (!linkedLaps && /run|track|treadmill/.test(linkedAct.type) && navigator.onLine) { const l = await fetchLaps(Number(linkedAct.id)).catch(() => null); if (l) { linkedLaps = l; saveLaps(linkedAct.id, l); } } }
    }
    const reviewOccurrence = (explicitlyReviewsRecord(value) || reviewAsk) ? effectiveSelected : null;
    const recordOccurrence = isNativeRecordInspection(value) ? effectiveSelected : reviewOccurrence;
    let brief = assembleCoachBrief(plan, value, recordOccurrence);
    brief={...brief,question:value.slice(0,8000)};
    setFuelPreview(brief.fuel ?? null);
    if (!retry) {
      const userMessage = { id: `${Date.now()}`, role: "user" as const, text: value };
      setMemory({ ...memory, messages: [...memory.messages, userMessage].slice(-40) });
    }
    setDraft("");
    const statedRpes=reportedSessionRpes(value);
    if(statedRpes.length===1)setRpeDraft(String(statedRpes[0]));
    setRetryQuestion(null);
    setSending(true);
    setFace("thinking");
    const athleteId=currentAthleteId(),asOf=new Date().toISOString();
    if(/设备|截图|心率|HRV|RHR/i.test(value)){
    try { brief=attachLinkedSources(brief,deviceCoachSources(await listConfirmedDeviceEvidence(),new Date().toISOString())); } catch { brief=attachLinkedSources(brief,[{id:"linked:device-unreadable",kind:"CONTEXT",detail:"设备证据库读取失败，不能认为没有记录"}]); }
    }
    const priorAnalysis=latestReasoningBasis(memory.messages,athleteId,asOf,brief.occurrenceId?[brief.occurrenceId]:[]);
    if (currentAthleteId() !== athleteId) { setSending(false); return; }
    let formal:ReturnType<typeof readFormalEvidenceRows>;
    try{formal=readFormalEvidenceRows(athleteId,asOf)}catch{
      setMemory(current=>current?{...current,messages:[...current.messages,{id:`${Date.now()}-evidence-failed`,role:'coach' as const,text:reasoningReadFailure(value,brief.pain||brief.constraints.medicalReferral)}].slice(-40)}:current);
      setSending(false);setFace('care');return;
    }
    const v4={athleteId,asOf,rows:formal.rows,unknownCommitTime:formal.unknownCommitTime.length,priorAnalysis};
    const reviewed=normalizeV4(v4,value,Date.now(),brief.occurrenceId??null);
    setChatLoad(chatLoadPreview(value)&&!reviewed?.reasoning.safety.mustRetain ? {question:value,id:`chat-load-${crypto.randomUUID()}`,occurrenceId:brief.occurrenceId} : null);
    const coachContextMemory = readCoachMemory(athleteId, asOf, reviewed?.review.audit.snapshot).active;
    // Compute once before any optional model call, so every failure has the same factual fallback.
      const periodIntent=value.match(/^(?:请)?复盘最近\s*(7|28)\s*天[。？?]?$/);
      let periodReview:ReturnType<typeof readCoachReviewWorkspace>['period']|undefined;
      if(periodIntent&&detectRedFlags(value).level==='NONE'&&!reviewed?.reasoning.safety.mustRetain){
        let failed=false;const devices=await listConfirmedDeviceEvidence().catch(()=>{failed=true;return []});
        try{periodReview=readCoachReviewWorkspace(athleteId,calendarDay(asOf)!,Number(periodIntent[1]),asOf,devices,failed).period}catch{/* Existing formal-evidence response remains available. */}
      }
      const local = answerLocally(brief,reviewed?{frame:reviewed.reasoning,snapshot:reviewed.review.audit.snapshot}:undefined,coachContextMemory,periodReview,memory.dialogue??emptyDialogue(athleteId));
      if (currentAthleteId() !== athleteId) { setSending(false); return; }
      if(!useCloud&&local.candidate){const savedAdvice=commitDisplayedCoachAdvice(local,value);if(!savedAdvice.ok)local.text+='\n本次建议历史保存失败，请先保留此回答；没有修改正式计划。'}
      setChatTraining(local.chatTraining??null);
      if(local.chatTraining)setChatLoad(null);
    if (!useCloud) {
      if(local.offlineReview&&!local.chatTraining&&!local.c03){const saved=saveOfflineReview(local.offlineReview);if(!saved.ok)setNotice('本地分析已生成，但判断历史未能保存；原训练记录仍保留。');}
      const intakeGoal=firstWeekGoalFromText(value);
      if(intakeGoal && local.cognition?.safety==='NONE' && !brief.pain)setFirstWeekGoalState({ athleteId, value: intakeGoal });
      setCognitionTurn(local.cognition ? {cognition: local.cognition, brief} : null);
      const conversation = extractConversationContext(memory.messages, value);
      const contextual = detectRedFlags(value).level!=='NONE'||local.offlineRuleIds?.length||local.reasoning?.scopeOccurrenceIds.length?null:contextualFollowup(value, conversation);
      // 安全门：急症/疼痛/必须保留的安全约束 → 只用本地安全回答，不联网、不替换。
      const redFlag = detectRedFlags(value).level !== "NONE" || brief.pain || brief.constraints.medicalReferral || !!reviewed?.reasoning.safety.mustRetain;
      // v87：待审知识预览、单纯换算、无候选的剩余任务只在本地展示，不联网、不被跑步复盘替换。
      const keepLocal = answerStaysLocal(local);
      let shown = local.dialogue || keepLocal ? local.text : presentCoachAnswer(local.text + (contextual ?? ""), persona);
      if (!redFlag && !keepLocal && linkedAct) shown = reviewActivity(linkedAct, linkedLaps, today);
      else if (!redFlag && !keepLocal) { const iv = intervalRestAnswer(value); if (iv) shown = iv; }
      let label = "本地分析";
      if (!redFlag && !keepLocal && onlineSetting().on && navigator.onLine !== false) {
        setNotice("联网分析中…");
        const r = await askOnlineCoach({ question: value, facts: buildFacts(today, linkedAct, linkedLaps, { goalTarget: memory.dialogue?.goalTarget ?? null }), local: shown, history: memory.messages.slice(-6).map(m => ({ role: m.role, text: m.text.slice(0, 400) })) });
        if ("text" in r) { shown = r.text; label = "联网分析"; } else { label = `本地分析 · 联网失败（${r.error}）`; }
        setNotice(linkNotice);
      }
      shown = `【${label}】\n${linkNotice ? linkNotice + "\n" : ""}${shown}`;
      const messageId = `${Date.now()}-local`;
      if (local.c03) pendingC03.current = { answer: local, athleteId, messageId };
      setMemory(current => current?.athleteId === athleteId ? { ...current, ...(local.dialogue?{dialogue:local.dialogue}:{}), messages: [...current.messages, { id: messageId, role: "coach" as const, text: shown,...(local.offlineReview?{factDetails:local.offlineReview.details}:{}),...(local.knowledgeUses?.length?{knowledgeUses:local.knowledgeUses}:{}),...(local.reasoning?.scopeOccurrenceIds.length?{analysisBasis:local.reasoning.basis,...(!local.reasoning.safety.mustRetain?{factDetails:formatComputedFacts(local.reasoning,true)}:{})}:{}) }].slice(-40) } : current);
      setOnlineRequest(null);
      setTurnId(null);
      setFace(brief.pain ? "guard" : "focus");
      setSending(false);
      return;
    }
    setOnlineRequest(null);
    const failure = (reason: CoachFailure) => {
      if (reason !== "NO_KEY" && reason !== "LOCKED") setRetryQuestion(value);
      const fallback=localModelFallback(local,reason);setNotice(fallback.notice);return fallback.text;
    };
    try {
      const history = memory.messages.slice(-8).map(({ role, text: prior }) => ({ role, text: prior.slice(0, 300) }));
      // Read-only formal rows for the V4 server review; this athlete only, unknown commit times stay out.
      const bound = listBoundTrainings();
      const candidates = bound.map((item) => ({ id: item.trainingOccurrenceId, startedAt: item.startedAt, running: item.running }));
      let citeBriefs: CoachBrief[] = [brief];
      const picked = compareA && compareB ? orderOccurrenceIds(compareA, compareB, bound) : null;
      let result: Awaited<ReturnType<typeof askCoach>>;
      if (seriesIds.length >= 3) {
        const series = assembleCoachSeries(plan, value, seriesIds);
        result = series
          ? await askCoach({ data: { brief, history, v4, coachContextMemory, series: { points: series.points } } })
          : { ok: true, compareIds: null, seriesIds: null, turn: { mode: "ask", text: "所选训练没有至少三次分属不同日期、同一槽位且各自可引用的完成记录，不能形成纵向观察。", nextStep: null, citations: [], medicalReferral: false, planChanged: false } };
        if (series) citeBriefs = series.points.map((point) => point.brief);
      } else if (compareA && compareB && !picked) {
        result = { ok: true, compareIds: null, seriesIds: null, turn: { mode: "ask", text: "请选择两节不同的训练再比较。", nextStep: null, citations: [], medicalReferral: false, planChanged: false } };
      } else if (picked) {
        const packets = separateBriefs(plan, value, picked.newerId, picked.olderId);
        result = packets
          ? await askCoach({ data: { brief, history, v4, coachContextMemory, compare: { left: packets.newer, right: packets.older, userSelected: true, leftStartedAt: picked.newerStartedAt, rightStartedAt: picked.olderStartedAt } } })
          : { ok: true, compareIds: null, seriesIds: null, turn: { mode: "ask", text: "这两节没有各自独立、可引用的训练记录，我不能把它们放在一起比较。", nextStep: null, citations: [], medicalReferral: false, planChanged: false } };
        if (packets) citeBriefs = [packets.newer, packets.older];
      } else {
        result = await askCoach({ data: { brief, history, v4, coachContextMemory, candidates } });
        if (result.ok && result.seriesIds) {
          const series = assembleCoachSeries(plan, value, result.seriesIds);
          result = series
            ? await askCoach({ data: { brief, history, v4, coachContextMemory, series: { points: series.points } } })
            : { ok: true, compareIds: null, seriesIds: null, turn: { mode: "ask", text: "这些训练没有至少三次分属不同日期、同一槽位且各自可引用的完成记录，暂时不能形成纵向观察。", nextStep: null, citations: [], medicalReferral: false, planChanged: false } };
          if (series) citeBriefs = series.points.map((point) => point.brief);
        } else if (result.ok && result.compareIds) {
          const ordered = orderOccurrenceIds(result.compareIds[0], result.compareIds[1], bound);
          if (!ordered) {
            result = { ok: true, compareIds: null, seriesIds: null, turn: { mode: "ask", text: "这两节没有各自独立、可引用的训练记录，我不能把它们放在一起比较。", nextStep: null, citations: [], medicalReferral: false, planChanged: false } };
          } else if (sameCalendarDay(ordered.newerStartedAt, ordered.olderStartedAt)) {
            result = { ok: true, compareIds: null, seriesIds: null, turn: { mode: "ask", text: "这两次训练在同一天，请用下面两栏选择要比较的两节。我不会把它们混成一节。", nextStep: null, citations: [], medicalReferral: false, planChanged: false } };
          } else {
            const packets = separateBriefs(plan, value, ordered.newerId, ordered.olderId);
            result = packets
              ? await askCoach({ data: { brief, history, v4, coachContextMemory, compare: { left: packets.newer, right: packets.older, userSelected: false, leftStartedAt: ordered.newerStartedAt, rightStartedAt: ordered.olderStartedAt } } })
              : { ok: true, compareIds: null, seriesIds: null, turn: { mode: "ask", text: "这两节没有各自独立、可引用的训练记录，我不能把它们放在一起比较。", nextStep: null, citations: [], medicalReferral: false, planChanged: false } };
            if (packets) citeBriefs = [packets.newer, packets.older];
          }
        }
      }
      const sources = citeBriefs.flatMap((item) => item.sources ?? []);
      const reply = result.ok
        ? [result.turn.text, result.turn.nextStep ? `\n下一步：${result.turn.nextStep}` : "", result.turn.citations.length ? `\n依据：${result.turn.citations.map((id) => { const source = sources.find((item) => item.id === id); return `${source?.detail ?? "来源"} [${id}]`; }).join("；")}` : ""].filter(Boolean).join("")
        : failure(result.reason);
      const coachId = `${Date.now()}-${result.ok?"coach":"fallback"}`;
      const guarded = result.ok && (result.turn.medicalReferral || citeBriefs.some((item) => item.pain || item.constraints.increaseBlocked));
      setTurnId(result.ok && result.turn.mode === "answer" ? coachId : null);
      setTurnQuestion(value);
      setFace(!result.ok ? "care" : guarded ? "guard" : result.turn.mode === "answer" ? "focus" : "encourage");
      setMemory((current) => (current?.athleteId === athleteId ? { ...current, messages: [...current.messages, { id: coachId, role: "coach" as const, text: presentCoachAnswer(reply, persona),...(result.ok&&result.analysisBasis?{analysisBasis:result.analysisBasis}:{}) }].slice(-40) } : current));
    } catch {
      setFace("care");
      setMemory((current) => (current?.athleteId === athleteId ? { ...current, messages: [...current.messages, { id: `${Date.now()}-fallback`, role: "coach" as const, text: failure("INTERRUPTED") }].slice(-40) } : current));
    } finally {
      setSending(false);
    }
  }

  const connectivity = isOnline === null ? "网络状态待确认" : isOnline ? "设备联网" : "设备离线";
  const statusLine = !memory || (memory.notes.length === 0 && memory.fatigue === 20 && memory.messages.every((item) => item.role !== "user")) ? "方坤本地常驻 · 公开知识参考可选 · 大模型需服务端授权" : "训练反馈已保留 · 恢复状态待评估";

  return (
    <div className={embedded ? "fk-coach-sheet flex min-h-0 flex-1 flex-col px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]" : "fixed inset-0 z-30 flex flex-col bg-bg"}>
      {/* R6：头像、状态和三段切换合成一行紧凑顶栏，把高度让给对话区 */}
      <div className={"fk-coach-bar flex items-center gap-2 pb-1 pt-0.5" + (embedded ? "" : " px-4")}>
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-surface" title={`方坤 · ${statusLine} · ${connectivity}`}>
          <span className="origin-center scale-[0.62]"><FangShen face={sending ? "thinking" : face} motion={motion} /></span>
        </span>
        <nav className="product-segments fk-coach-tabs min-w-0 flex-1" aria-label="方坤工作区">
          {([["chat", "对话"], ["learn", "学习"], ["review", "复盘"]] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>)}
        </nav>
        {embedded ? null : <button type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center" aria-label="关闭"><X className="size-5" /></button>}
      </div>
      {coachSaveFailed ? <div className="mx-4 mb-2 flex flex-wrap items-center gap-2 text-sm">
        <p>教练记录没有写入本机，原来的记录还在。</p>
        <button type="button" className="min-h-11 rounded-card border border-line px-3 font-bold" onClick={() => { if (memory && saveCoach(memory)) setCoachSaveFailed(false); }}>再存一次</button>
      </div> : null}
      <div data-testid="coach-messages" className={"min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-2 " + (embedded ? "px-0.5" : "px-4")}>
        {section === "learn" ? <LearningLibrary onNavigate={onNavigate} publicReferencesAllowed={authorizeNetworkAction({ mode: networkMode, action: "open-public-reference", online: isOnline ?? undefined }).allowed} /> : null}
        <div hidden={section !== "review"} className="space-y-3" aria-label="训练复盘工作区">
        {coordinationPanel ?? null}
        {section === 'review' && <CoachPlanChangePanel revision={recordRevision} />}
        {section === 'review' && <CoachC03FollowupPanel revision={recordRevision} />}
        {section === 'review' && <CoachOfflineLoopPanel plan={plan} revision={recordRevision} />}
        {section === 'review' && <CoachIntegrationPanel revision={recordRevision} prepareInput={() => {
          const athleteId = currentAthleteId(), asOf = new Date().toISOString();
          const formal = readFormalEvidenceRows(athleteId, asOf);
          const brief = assembleCoachBrief(plan, draft.trim() || '这次训练怎么样', selectedOccurrenceId);
          const v4 = { athleteId, asOf, rows: formal.rows, unknownCommitTime: formal.unknownCommitTime.length };
          const reviewed = normalizeV4(v4, brief.question, Date.now(), brief.occurrenceId ?? null);
          const coachContextMemory = readCoachMemory(athleteId, asOf, reviewed?.review.audit.snapshot).active;
          const history = (memory?.messages ?? []).slice(-8).map(({ role, text }) => ({ role, text: text.slice(0, 300) }));
          return buildCoachModelRequest(normalizeAskCoachInput({ brief, history, v4, coachContextMemory })).inputSummary;
        }} />}
        <div className="flex justify-start gap-2">
          <span className="mt-1 grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-surface"><span className="origin-center scale-[0.45]"><FangShen face="happy" motion={false} /></span></span>
          <p className="max-w-[85%] rounded-2xl rounded-tl-md stat-run px-3 py-2 text-sm">你好。建议只依据已保存的训练记录。数据不足时会说明，不会编造疲劳、恢复或伤病结论。</p>
        </div>
        <div className="rounded-2xl bg-surface px-3 py-3 text-sm">
          <label htmlFor="coach-persona" className="font-bold">方坤的说话风格</label>
          <select id="coach-persona" value={persona} onChange={(e) => { const next = parsePersona(e.target.value); setPersona(next); try { window.localStorage.setItem(PERSONA_KEY, next); } catch { /* current session only */ } }} className="ml-2 rounded-lg border border-line bg-surface px-2 py-2">
            {PERSONAS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted">{PERSONAS.find(item => item.id === persona)?.description}。仅改变表达方式，不改变医学警示、训练决策或冻结权限。</p>
        </div>
        {onControlledStrengthEdit ? <details className="mb-2 rounded-card border border-line p-2"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">未来力量计划 · 预览修改与撤销</summary><CoachStrengthEditPanel plan={plan} onAction={onControlledStrengthEdit} /></details> : null}
        <details className="mb-2 rounded-card border border-line p-2"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">设备截图 / 身体数据 / 单次分段识别（本地免费）</summary><DeviceEvidenceImport /></details>
        <details className="rounded-2xl bg-surface px-3 py-2 text-xs text-muted" aria-label="方坤教练功能说明">
          <summary className="min-h-11 cursor-pointer font-bold text-fg">训练复盘、比较和证据</summary>
          <p className="mt-2">训练状态在下方「今日状态与专业分析」。关联训练、RPE、恢复和疼痛在输入框上方。历史记录在日志，体重和饮食在身体。动效现在是{motion ? "开" : "关"}。</p>
          <button type="button" className="mt-2 min-h-10 rounded-full border border-line px-3" onClick={() => { const next = !motion; setMotion(next); window.localStorage.setItem("fr255-fangshen-motion", next ? "on" : "off"); }}>动效{motion ? "开" : "关"}</button>
          <button type="button" className="mt-2 ml-2 min-h-10 rounded-full border border-line px-3" onClick={() => { setSection("chat"); setDraft("比较两节训练的完成情况和实际休息"); }}>比较两节训练</button>
          <div className="mt-2 flex flex-wrap gap-2">
            {COACH_CHIPS.map((chip) => (
              <button key={chip} type="button" onClick={() => void send(chip)} disabled={sending} className="min-h-9 max-w-full whitespace-normal rounded-full border border-line px-3 py-2 text-left text-xs">{chip}</button>
            ))}
          </div>
          <p className="mt-2">普通问答默认本地运行，最近8轮用户对话可用于补充上下文；不会自动修改训练计划。线上大模型仅在主动申请时使用。</p>
        </details>
        {athlete && screen ? (
          <details data-testid="coach-analysis" className="rounded-card border border-line bg-surface p-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">今日状态与专业分析 · 点击展开</summary>
          <div className="mt-3 space-y-3">
            <CoachStatusCard
              tone={screen.decision ? toneFor(screen.decision.readiness) : "unknown"}
              recovery={athlete.recovery.recoveryStatus}
              load={athlete.training.strengthLoad == null ? "未记录" : `${athlete.training.strengthLoad} 组`}
              cycle={athlete.training.currentWeek ? `第 ${athlete.training.currentWeek} 周` : "未记录"}
              limiter={limiterFrom({ pain: athlete.recovery.pain, fatigue: athlete.recovery.fatigueScore })}
              suggestion={screen.decision?.reason ?? "还没有今天的建议"}
            />
            {inbox ? (
              <DecisionInbox
                decision={inbox}
                onAccept={() => {
                  const result = acceptIssued(inbox.decision_id);
                  setInbox(loadDecisions().find((item) => item.decision_id === inbox.decision_id) ?? null);
                  setNotice(result.ok ? "已记下。原来的课表没有改。" : result.reason);
                }}
                onKeep={() => {
                  rejectIssued(inbox.decision_id);
                  setInbox(loadDecisions().find((item) => item.decision_id === inbox.decision_id) ?? null);
                  setNotice("保持原计划。建议还在，课表没有改。");
                }}
                onEdit={(text) => {
                  overrideIssued(inbox.decision_id, text);
                  setInbox(loadDecisions().find((item) => item.decision_id === inbox.decision_id) ?? null);
                  setNotice("已记下你的改法。原建议还在，这不代表建议错了。课表没有改。");
                }}
              />
            ) : (
              <button type="button" className="h-11 rounded-card border border-line px-3 text-sm" onClick={() => {
                const decision = issueTrainingDecision(plan, athlete);
                setInbox(decision);
                setNotice(decision ? "已按现有规则生成或找回训练建议。课表没有改。" : "当前没有可生成建议的训练计划。");
              }}>生成或查看训练建议</button>
            )}
            {screen.decision?.readiness === "READY" && athlete.recovery.sleep == null ? (
              <p className="text-sm">规则分析给出 READY。没有睡眠记录，不能把它看成恢复正常。决策结果没有在这页被改掉。核心待修复项：证据不足时引擎仍可能返回 READY。</p>
            ) : null}
            <p className="text-xs text-muted">下面分开显示：已确认训练事实、可追溯的规则分析、证据不足、尚未接入的能力。模型回答仍未开放，不会用固定话术冒充。</p>
            {screen.decision && screen.planned ? (
              <DecisionCard
                decision={screen.decision}
                planned={`${screen.planned.weightKg > 0 ? `${screen.planned.weightKg}kg × ` : ""}${screen.planned.sets} × ${screen.planned.amount}`}
                onAccept={() => {
                  if (!screen.decision) return;
                  chooseAction(screen.decision.decision_id, "AI_RECOMMENDED");
                  setNotice("已记下建议。课表没有改。");
                }}
                onOriginal={() => {
                  chooseAction(screen.decision!.decision_id, "ORIGINAL_PLAN");
                  setNotice("按原计划。建议没有改课。");
                }}
                onEdit={() => {
                  chooseAction(screen.decision!.decision_id, "USER_MODIFIED");
                  onClose();
                }}
                onHold={() => setNotice("这次先不执行。课表没有改。")}
              />
            ) : null}
            {screen.review ? <SessionReview view={screen.review} /> : <p className="text-sm text-muted">这次训练还没有完成记录。</p>}
            <TodayState
              recovery={athlete.recovery.recoveryStatus}
              fatigue={athlete.recovery.fatigueScore}
              usable={athlete.performance.todayUsable}
              uncalibrated={!memory || (memory.notes.length === 0 && memory.fatigue === 20 && memory.messages.every((item) => item.role !== "user"))}
              sleep={athlete.recovery.sleep}
              painNoted={athlete.recovery.pain}
              sessionRpe={latestSessionRpe(loadEvents())}
            />
            <CoachLoadMetricsPanel revision={recordRevision} />
            <p className="text-sm text-muted">在训练复盘中查看五维原始指标与历史判断。资料不足的维度显示待评估；未经核准的经验分不代表当前能力。</p>
            {competitionView({
              target: athlete.competition.target,
              date: athlete.competition.date,
              days: athlete.competition.daysRemaining,
              week: athlete.training.currentWeek,
              bias: null,
            }) ? (
              <p className="text-sm">
                比赛 {athlete.competition.target || "已设日期"} · {athlete.competition.date} · 还有 {athlete.competition.daysRemaining} 天
              </p>
            ) : (
              <p className="text-sm text-muted">没有未过期的比赛日期。</p>
            )}
            <p className="text-sm text-muted">{trendText(0).note}</p>
            <p className="text-sm text-muted">
              热量 {athlete.nutrition.calorieTarget ?? "未记录"} · 蛋白质 {athlete.nutrition.proteinConsumed ?? "未记录"} · 体重 {athlete.physical.weight ?? "未记录"} · {athlete.physical.bodyTrend}
            </p>
            <div className="flex gap-2">
              <button type="button" className="h-11 rounded-card border border-line px-3 text-sm" onClick={() => onJump?.("body")}>记热量和身体</button>
            </div>
            {notice ? <p className="text-sm">{notice}</p> : null}
          </div>
          </details>
        ) : null}
        {pending ? (
          <section className="rounded-card border border-line p-3 text-sm">
            <p className="font-bold">一条还没执行的建议 · {pending.risk}</p>
            <p className="mt-1">{pending.reasoning}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="h-11 rounded-card bg-accent px-3 font-bold text-accent-fg"
                onClick={() => {
                  const result = executeDecision(pending.decision_id, true);
                  setPending(null);
                  setNotice(result.ok ? "已记下，课表没有被建议改掉。" : result.reason);
                }}
              >
                接受
              </button>
              <button
                type="button"
                className="h-11 rounded-card border border-line px-3"
                onClick={() => {
                  rejectDecision(pending.decision_id);
                  setPending(null);
                }}
              >
                不采用
              </button>
            </div>
            <div className="mt-2 flex gap-2">
              <input value={change} onChange={(event) => setChange(event.target.value)} placeholder="要改成什么" className="h-11 min-w-0 flex-1 rounded-card border border-line bg-bg px-3 outline-none" />
              <button
                type="button"
                className="h-11 shrink-0 rounded-card border border-line px-3"
                onClick={() => {
                  if (!change.trim()) return;
                  recordOverride({ originalValue: pending.reasoning, newValue: change.trim(), reason: "COACH_DISAGREEMENT", risk: pending.risk, decisionId: pending.decision_id, overridden: true });
                  setPending(null);
                  setChange("");
                }}
              >
                按我的改
              </button>
            </div>
          </section>
        ) : null}
        </div>
        <div hidden={section !== "chat"} className="space-y-3" aria-label="方坤对话区">
        <p className="product-chat-intro">说说你的目标，或选择一节训练一起看。方坤会先核对事实，再解释与建议。</p>
        <details data-testid="coach-disclaimer" className="text-xs text-muted"><summary className="min-h-8 cursor-pointer">使用说明与免责声明</summary><p>方坤提供训练分析与建议，不是医疗诊断，不能替代现场教练或医疗评估。回答可能有误，请核对关键记录；建议由你决定是否采用，接受聊天建议不会自动改课。每条回答下方可反馈问题。</p></details>
        <details open={Boolean(firstWeekGoal)} className="home-card p-3"><summary className="min-h-11 cursor-pointer text-sm font-bold">首次使用 · 目标与首周计划</summary><CoachFirstWeekPanel key={athleteScope} requestedGoal={firstWeekGoal} /></details>
        {cognitionTurn && <CoachCognitionPanel key={`${cognitionTurn.brief.occurrenceId}:${cognitionTurn.brief.question}`} cognition={cognitionTurn.cognition} brief={cognitionTurn.brief} />}
        {memory?.messages.filter((message) => message.id !== "hi").map((message) => (
          <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm " +
                (message.role === "user" ? "rounded-tr-md bg-accent text-accent-fg" : "rounded-tl-md stat-run text-fg")
              }
            >
              {message.role==='coach'&&(message.id.endsWith('-local')||message.id.endsWith('-fallback'))&&!message.text.startsWith('【')?<span className="mb-1 block text-xs text-muted">本地分析</span>:null}
              {message.role==='coach'?<CoachAnswerView text={message.text.split('\n依据：')[0]}/>:<span className="whitespace-pre-wrap">{message.text}</span>}
              {message.role==='coach'&&message.text.includes('\n依据：')?<details data-testid="coach-sources" className="mt-2 text-xs text-muted"><summary className="min-h-8 cursor-pointer">查看记录依据</summary><p className="whitespace-pre-wrap break-words">{message.text.slice(message.text.indexOf('\n依据：')+4)}</p></details>:null}
              {knowledgeReview.get(message.id)?<p data-testid="coach-knowledge-review" role="status" className="keep mt-1 text-xs text-amber-400">这条回答引用的知识卡已变化或批准已失效，结论需要复核（原回答保留）。</p>:null}
              {message.factDetails?<details data-testid="coach-fact-details" className="mt-2 text-xs"><summary className="min-h-8 cursor-pointer">查看分段核算详情</summary><p className="whitespace-pre-wrap break-words">{message.factDetails}</p></details>:null}
              {message.role==='coach'?<CoachAnswerFeedbackForm messageId={message.id} answer={message.text}/>:null}
            </div>
          </div>
        ))}
        {chatLoad && <CoachChatLoadPanel key={chatLoad.id} question={chatLoad.question} draftId={chatLoad.id} selectedOccurrenceId={chatLoad.occurrenceId} onSaved={() => setRecordRevision(n => n + 1)} />}
        {chatTraining&&<CoachChatTrainingPanel key={chatTraining.id} chat={chatTraining} selectedOccurrenceId={selectedOccurrenceId} onSaved={occurrenceId=>{setRecordRevision(n=>n+1);setChatTraining(chat=>chat?{...chat,savedOccurrenceId:occurrenceId}:chat);setMemory(m=>m?.dialogue?.lastTraining?.id===chatTraining.id?{...m,dialogue:{...m.dialogue,lastTraining:{...m.dialogue.lastTraining,savedOccurrenceId:occurrenceId}}}:m)}}/>}
        <div ref={bottom} />
        </div>
      </div>
      <div hidden={section !== "chat"} className={"min-h-0 max-h-[50dvh] shrink-0 overflow-y-auto " + (embedded ? "pt-1" : "border-t border-line px-4 py-2 pb-[max(0.5rem,var(--fk-safe-bottom))]")}>
        {activityNotices.length ? <div className="mb-2 rounded-card border border-line p-2 text-xs" aria-live="polite"><div className="flex justify-between gap-2"><strong>方坤 · 本次打开期间的活动</strong><button type="button" onClick={() => setActivityNotices([])}>清除提示</button></div>{activityNotices.map(item => <p key={item.id} className="mt-1">{item.message}</p>)}</div> : null}
        {onlineRequest ? <div className="mb-2 flex flex-wrap items-center gap-2 text-xs"><span>复杂问题可主动尝试线上大模型（必须有服务端授权或额度；当前未实现赠送额度发放）。点击将发送问题及相关训练摘要给服务端，请先确认隐私。</span><button type="button" className="min-h-10 rounded-card border border-line px-3" disabled={sending || isOnline === false} onClick={() => void send(onlineRequest, true, true)}>{isOnline === false ? "离线不可调用" : "确认尝试线上回答"}</button><button type="button" className="min-h-10 px-2" onClick={() => setOnlineRequest(null)}>暂不使用</button></div> : null}
        {retryQuestion ? (
          <button type="button" className="mb-2 h-11 rounded-card border border-line px-3 text-sm" disabled={sending} onClick={() => void send(retryQuestion, true, true)}>
            重试这一问
          </button>
        ) : null}
        {turnId ? (
          <div className="mb-2 flex flex-wrap gap-2">
            <button type="button" className="h-11 rounded-card border border-line px-3 text-sm" onClick={() => { recordCoachChoice({ choice: "accept", question: turnQuestion }); setTurnId(null); setNotice("已记下接受。课表没有改。"); }}>接受</button>
            <button type="button" className="h-11 rounded-card border border-line px-3 text-sm" onClick={() => { recordCoachChoice({ choice: "reject", question: turnQuestion }); setTurnId(null); setNotice("已拒绝。课表没有改。"); }}>不采用</button>
            <input value={choiceNote} onChange={(event) => setChoiceNote(event.target.value)} placeholder="我的修改或 Override" aria-label="我的修改或 Override" className="h-11 min-w-0 flex-1 rounded-card border border-line bg-surface px-3 text-sm" />
            <button type="button" disabled={!choiceNote.trim()} className="h-11 rounded-card border border-line px-3 text-sm disabled:opacity-50" onClick={() => { recordCoachChoice({ choice: "modify", question: turnQuestion, note: choiceNote }); setTurnId(null); setChoiceNote(""); setNotice("已记下你的修改。课表没有改。"); }}>按我的改</button>
          </div>
        ) : null}
        <div className="fk-coach-dock flex flex-wrap items-center gap-1.5">
        <details data-testid="coach-status-row" className="fk-coach-status shrink-0 rounded-full border border-line text-xs"><summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 px-2.5 text-muted"><span className={"size-2 shrink-0 rounded-full " + (onlineOn ? "bg-emerald-400" : "bg-line")} /><span className="min-w-0 flex-1 truncate">{onlineOn ? "联网分析 开" : "本地分析"} · {link === "unbound" ? "未绑定上传" : selectedOccurrenceId ? "已关联训练" : "未关联训练"}</span><span aria-hidden="true">▾</span></summary><div className="max-h-[45dvh] overflow-y-auto px-2 pb-2">
        <p className="mb-2 px-1 text-muted">{statusLine} · {connectivity}</p>
        <label className="mb-2 flex min-h-11 items-center gap-2 rounded-card border border-line px-3 text-xs"><input type="checkbox" aria-label="联网分析" checked={onlineOn} onChange={(e) => { persistOnline(e.target.checked); setOnlineOn(e.target.checked); }} /><span><b>联网分析{onlineOn ? "已开启" : "已关闭"}</b>：经服务端调用 DeepSeek，只发送去标识化的训练数值、分段、恢复指标和计划目标，不发送账号或位置；离线或失败时自动用本地分析。急症/疼痛问题始终本地处理。</span></label>
        <details className="coach-network-card mb-2 rounded-card border border-line p-3 text-xs" aria-label="方坤联网权限"><summary className="min-h-11 cursor-pointer font-bold">联网与隐私权限（按需展开）</summary>
          <div className="mb-2 font-semibold">联网知识权限 · {networkMode === "local" ? "本地优先" : "公开知识已允许"}</div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={networkMode === "public-knowledge"} onChange={(e) => { const next = e.target.checked ? "public-knowledge" : "local"; setNetworkMode(next); try { window.localStorage.setItem(COACH_NETWORK_MODE_KEY, next); } catch { /* storage unavailable */ } }} />允许打开公开运动科学参考资料（不上传训练和身体记录）</label>
          {networkMode === "public-knowledge" && <div className="mt-2 flex flex-wrap gap-2">{COACH_PUBLIC_REFERENCES.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className="underline" onClick={(event) => { if (!authorizeNetworkAction({ mode: networkMode, action: "open-public-reference", online: isOnline ?? undefined }).allowed) event.preventDefault() }}>{item.label}</a>)}</div>}
          <div className="mt-1 text-muted">公开链接仅供人工查阅；自动检索、内容核验和付费模型额度服务尚未接入。</div>
        </details>
        <details data-testid="coach-record-binding" className="mb-2 rounded-card border border-line px-3 py-2 text-xs">
          <summary className="min-h-9 cursor-pointer break-words font-bold text-fg">{link === "unbound" ? "未绑定上传，没有自动关联" : selectedOccurrenceId ? `当前关联：${coachImports().find(item=>item.confirmedImportId===selectedOccurrenceId)?.title.value ?? listBoundTrainings().find(item=>item.trainingOccurrenceId===selectedOccurrenceId)?.sessionId ?? '已选训练'}` : "尚未关联具体训练 · 按需展开"}</summary>
          <p className="mb-2 mt-1 text-muted">多节训练不会自动猜测归属；需要引用成绩、比较训练或记录身体反馈时再选择。</p>
        <label className="mb-2 flex items-center gap-2 text-xs text-muted">
          本次问答关联训练
          <select value={selectedOccurrenceId ?? ""} onChange={(event) => { setSelectedOccurrenceId(event.target.value || null); setRpeDraft(""); setRecoveryDraft(""); setBodyLocation(""); setBodyIntensity(""); }} className="h-10 min-w-0 flex-1 rounded-card border border-line bg-surface px-2 text-fg" aria-label="选择训练记录">
            <option value="">{occurrences.length > 1 ? "请选择，避免误绑" : "尚无可追溯训练"}</option>
            {coachImports().filter(item=>!occurrenceVoided(item.confirmedImportId)).map(item=><option key={item.confirmedImportId} value={item.confirmedImportId}>已确认导入 · {item.occurredAt.value} · {item.title.value ?? item.sport}</option>)}
            {occurrences.map((item) => <option key={item.trainingOccurrenceId} value={item.trainingOccurrenceId}>{formatTrainingWhen(item.startedAt ?? "")} · {item.sessionId} · {item.trainingOccurrenceId.slice(0, 8)}</option>)}
          </select>
        </label>
        {selectedOccurrenceId ? <RunningRoundReadout occurrenceId={selectedOccurrenceId} /> : null}
        {fuelPreview ? (
          <p className="mb-2 text-xs text-muted">
            {fuelPreview.status === "DIFFERENT_DAY"
              ? "所选训练不是上海日历的今天，不借用今天的饮食记录。"
              : fuelPreview.status === "NO_RECORD"
                ? `今天已记录摄入：未记录 · 热量目标 ${fuelPreview.targetKcal ?? "未设置"}`
                : `今天热量目标 ${fuelPreview.targetKcal ?? "未设置"} · 已记录摄入 ${fuelPreview.recordedKcal} 千卡（可能未记全）`}
          </p>
        ) : null}
        <div className="mb-2 grid grid-cols-1 gap-2 text-xs text-muted">
          <label className="flex items-center gap-2">
            比较第一节
            <select value={compareA} onChange={(event) => setCompareA(event.target.value)} className="h-10 min-w-0 flex-1 rounded-card border border-line bg-surface px-2 text-fg" aria-label="比较第一节">
              <option value="">不指定</option>
              {listBoundTrainings().map((item) => <option key={item.trainingOccurrenceId} value={item.trainingOccurrenceId}>{formatTrainingWhen(item.startedAt)} · {item.sessionId}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            比较第二节
            <select value={compareB} onChange={(event) => setCompareB(event.target.value)} className="h-10 min-w-0 flex-1 rounded-card border border-line bg-surface px-2 text-fg" aria-label="比较第二节">
              <option value="">不指定</option>
              {listBoundTrainings().map((item) => <option key={item.trainingOccurrenceId} value={item.trainingOccurrenceId}>{formatTrainingWhen(item.startedAt)} · {item.sessionId}</option>)}
            </select>
          </label>
        </div>
        <details className="mb-2 rounded-card border border-line px-3 py-2 text-xs">
          <summary className="cursor-pointer font-bold text-fg">纵向观察：已选 {seriesIds.length}/6 节（至少选 3 节）</summary>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {occurrences.map((item) => {
              const checked = seriesIds.includes(item.trainingOccurrenceId);
              return <label key={item.trainingOccurrenceId} className="flex min-h-10 items-center gap-2">
                <input type="checkbox" checked={checked} disabled={!checked && seriesIds.length >= 6} onChange={() => setSeriesIds((current) => toggleSeriesId(current, item.trainingOccurrenceId))} />
                <span>{formatTrainingWhen(item.startedAt ?? "")} · {item.sessionId}</span>
              </label>;
            })}
          </div>
          {seriesIds.length ? <button type="button" className="mt-2 h-10 rounded-card border border-line px-3" onClick={() => setSeriesIds([])}>清空纵向选择</button> : null}
          <p className="mt-1 text-muted">选满后，下一问直接走正式纵向分析，省去候选路由。</p>
        </details>
        {selectedOccurrenceId ? <div className="mb-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">这节训练整体有多吃力？</span>
            <input type="number" min="1" max="10" step="1" value={rpeDraft} onChange={(event) => setRpeDraft(event.target.value)} placeholder="整课 RPE 1–10" aria-label="本次训练 RPE" className="h-10 w-32 rounded-card border border-line bg-surface px-2" />
            <input type="number" min="1" max="10" step="1" value={recoveryDraft} onChange={(event) => setRecoveryDraft(event.target.value)} placeholder="恢复感 1–10" aria-label="本次主观恢复" className="h-10 w-32 rounded-card border border-line bg-surface px-2" />
            <button type="button" className="h-10 rounded-card border border-line px-3" onClick={() => {
              const result = selectedOccurrenceId.startsWith("confirmed:") ? confirmImportedSessionRpe(selectedOccurrenceId,Number(rpeDraft)) : recordCoachEvidence(selectedOccurrenceId, { sessionRpe: rpeDraft ? Number(rpeDraft) : undefined, subjectiveRecovery: recoveryDraft ? Number(recoveryDraft) : undefined });
              setNotice(result.ok ? `${result.reason} 重复确认不会重写。` : result.reason);
              if (result.ok) { setRpeDraft(""); setRecoveryDraft(""); setAthlete(refreshAthleteState()); }
            }}>保存为整课RPE</button>
          </div>
          <details className="mt-2 rounded-card border border-line px-3 py-2 text-muted">
            <summary className="min-h-10 cursor-pointer font-bold text-fg">用力说明（自己选，不会自动打分）</summary>
            <p className="mt-2">产品引导，不是经过验证的中文版量表。不把分数对应固定配速、心率或剩余次数。空白是未记录。整课 RPE 和某一组的用力不是一回事。切换训练会清掉还没保存的草稿。</p>
            <ul className="mt-2 list-disc pl-4">
              <li>1–2：很轻松，呼吸平稳。</li>
              <li>3–4：轻松，能说话。跑步像放松跑，力量留有很多余力。</li>
              <li>5–6：中等，说话开始断续。</li>
              <li>7–8：很吃力，只能说短句。</li>
              <li>9–10：极吃力。10 不是必须打到，也不等于应该做到失败。</li>
            </ul>
          </details>
        </div> : null}
        {selectedOccurrenceId ? <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">身体反馈（确认后绑定本次训练）</span>
          <select value={bodyKind} onChange={(event) => setBodyKind(event.target.value as "SORENESS" | "PAIN")} aria-label="反馈类型" className="h-10 rounded-card border border-line bg-surface px-2">
            <option value="SORENESS">酸痛</option><option value="PAIN">疼痛</option>
          </select>
          <input value={bodyLocation} onChange={(event) => setBodyLocation(event.target.value)} maxLength={40} placeholder="部位，例如左膝" aria-label="反馈部位" className="h-10 min-w-0 flex-1 rounded-card border border-line bg-surface px-2" />
          <input type="number" min="1" max="10" step="1" value={bodyIntensity} onChange={(event) => setBodyIntensity(event.target.value)} placeholder="程度 1–10" aria-label="反馈程度" className="h-10 w-28 rounded-card border border-line bg-surface px-2" />
          <button type="button" className="h-10 rounded-card border border-line px-3" onClick={() => {
            const result = recordCoachBodyEvidence(selectedOccurrenceId, { kind: bodyKind, location: bodyLocation, intensity: Number(bodyIntensity) });
            setNotice(result.reason);
            if (result.ok) { setBodyLocation(""); setBodyIntensity(""); }
          }}>确认身体反馈</button>
        </div> : null}
        </details>
        </div></details>
        <div className={"fk-coach-quick min-w-0 flex-1 gap-1.5 overflow-x-auto " + (draft.trim() ? "hidden" : "flex")}>
          <button type="button" className="min-h-8 shrink-0 rounded-full border border-line bg-surface px-2.5 text-xs" onClick={() => { setSection("chat"); setDraft("帮我复盘这节训练，先说明已记录事实和缺失数据"); }}>分析最近训练</button>
          <button type="button" className="min-h-8 shrink-0 rounded-full border border-line bg-surface px-2.5 text-xs" onClick={() => { setSection("chat"); setDraft("根据已记录的恢复、睡眠和疼痛，说明现在不能确认什么"); }}>解释恢复数据</button>
          <button type="button" className="min-h-8 shrink-0 rounded-full border border-line bg-surface px-2.5 text-xs" onClick={() => { setSection("chat"); setDraft("查看我已保存的专项目标，不要假设没有写下的成绩"); }}>查看专项目标</button>
          <button type="button" className="min-h-8 shrink-0 rounded-full border border-line bg-surface px-2.5 text-xs" onClick={() => { setSection("chat"); setDraft("为什么相同的400米×8，组间休息1分钟和8分钟训练刺激不同？"); }}>理解间歇原理</button>
          <button type="button" className="min-h-8 shrink-0 rounded-full border border-line bg-surface px-2.5 text-xs" onClick={() => { setSection("chat"); setDraft("为什么深蹲力量提升，不一定提高400米跑步成绩？"); }}>力量如何迁移</button>
        </div>
        </div>
        <form
          className="flex gap-2 pt-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest" })}
            placeholder="输入你的问题"
            enterKeyHint="send"
            className="h-11 min-w-0 flex-1 rounded-full border border-line bg-surface px-4 outline-none"
          />
          <button type="submit" disabled={sending} aria-label="发送" className="grid size-11 shrink-0 place-items-center rounded-full bg-[#183f56] text-white disabled:opacity-50">
            <Send className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
