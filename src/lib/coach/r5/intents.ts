import type { Profile } from "../../strength/profile";
import type { SymptomInput } from "../../health/symptom-store";
import { validDay, localDay } from "../../health/observation";
import { addDays, weekOf } from "../../ui/day-schedule-rules";
import { detectRedFlags } from "../../core/coach-red-flags";
export type R5Intent =
  | { kind: "MEASUREMENT"; weight: number; day: string; historical: boolean }
  | { kind: "PROFILE"; patch: Partial<Profile> }
  | { kind: "EASY_RUN"; day: string }
  | { kind: "REDUCE_SETS"; days: string[] }
  | { kind: "SYMPTOM"; input: SymptomInput }
  | { kind: "WEEKLY" }
  | { kind: "CLARIFY"; message: string }
  | { kind: "NONE" };
const num = "([0-9]+(?:\\.[0-9]+)?)";
/** Whole-message safety runs before routing or a confirmation write. */
export function currentMessageSafety(question: string): string | null {
  const flags = detectRedFlags(question),
    q = question.normalize("NFKC");
  if (flags.level === "EMERGENCY" || flags.level === "URGENT_MEDICAL")
    return "停止训练；当前症状需要立即医疗评估，出现紧急症状请联系当地急救。资料或改课请求尚未执行。";
  const request =
    /改成|改为|修改|更正|减少|少一组|体重|年龄|身高|备注|周复盘|下周计划|下周草案|每周复盘/.test(q);
  const raw = q.replace(/没有疼痛|没有酸痛|不痛|不疼|无痛|不受限/g, "");
  const currentPain =
    !/朋友|队友|假设|举例|如果|曾经|去年|以前/.test(q) &&
    /(?:膝|腿|踝|脚|足|腰|背|肩|髋|跟腱).{0,8}(?:痛|疼)|疼痛|跛行|走路受限|无法负重/.test(raw);
  if (request && (flags.level !== "NONE" || currentPain))
    return "先暂停诱发疼痛或功能受限的训练，必要时寻求医疗评估。当前信息不能通过改成轻松跑或设备分数放行；这次修改尚未执行。请先单独记录疼痛部位、程度及功能影响。";
  return null;
}
function requestedDay(q: string, today: string): string | null {
  const explicit = q.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (explicit) return validDay(explicit) ? explicit : null;
  const dow = q.match(/(?:周|星期)([一二三四五六日天])/);
  if (dow) {
    const i = "一二三四五六日".indexOf(dow[1] === "天" ? "日" : dow[1]);
    let day = weekOf(addDays(today, /下周/.test(q) ? 7 : 0))[i];
    if (!/本周|这周|下周/.test(q) && day < today) day = addDays(day, 7);
    return day;
  }
  return /今天/.test(q) ? today : null;
}
export function parseR5Intent(question: string, now = new Date().toISOString()): R5Intent {
  const q = question.trim().normalize("NFKC"),
    today = localDay(new Date(now));
  if (!q || q.length > 1000 || !Number.isFinite(Date.parse(now)))
    return { kind: "CLARIFY", message: "请输入1000字以内的问题，并核对时间。" };
  if (
    /朋友|队友|假设|比如|例如|举例|如果|不要(?:修改|记录|保存)|不(?:是|想|要).*?(?:改|记)|能不能|是否|怎么|如何|为什么|能否/.test(
      q,
    )
  )
    return { kind: "NONE" };
  const danger = currentMessageSafety(q);
  if (danger) return { kind: "CLARIFY", message: danger };
  if (/周复盘|每周复盘|这周总结|本周总结|下周计划|下周草案/.test(q)) return { kind: "WEEKLY" };
  if ((q.match(/\d+(?:\.\d+)?\s*(?:公斤|千克|kg)/gi) ?? []).length > 1)
    return {
      kind: "CLARIFY",
      message: "这句话有多个体重值。请分别更正当前测量和目标体重，我会为每项展示独立确认卡。",
    };
  const w = q.match(
    /(?:体重(?:为|是|改为|改成|更正为)?|重)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:公斤|千克|kg)/i,
  );
  if (w) {
    const weight = Number(w[1]);
    if (weight < 30 || weight > 250)
      return { kind: "CLARIFY", message: "请核对体重数值和单位；这次没有保存。" };
    const clause =
      q
        .slice(0, w.index! + w[0].length)
        .split(/[，,。；;]/)
        .at(-1) ?? "";
    if (/目标体重|目标(?:是|为|改为|改成)?|希望|想(?:到|达)/.test(clause))
      return { kind: "PROFILE", patch: { targetKg: String(weight) } };
    const date = q.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (date && (!validDay(date) || date > today))
      return { kind: "CLARIFY", message: "测量日期应为有效的今天或过去日期。" };
    if (/之前|上次|历史|昨天|前天/.test(q) && !date)
      return { kind: "CLARIFY", message: "要更正哪一天的体重？请给出具体日期，例如2026-10-20。" };
    return {
      kind: "MEASUREMENT",
      weight,
      day: date ?? today,
      historical: !!date && date !== today,
    };
  }
  const patch: Partial<Profile> = {};
  const age = q.match(/(?:我(?:现在|今年)?|年龄(?:是|改为)?)\s*(\d{1,3})\s*岁/);
  if (age && Number(age[1]) > 0 && Number(age[1]) <= 120) patch.age = age[1];
  const height = q.match(/身高(?:是|为|改为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:厘米|cm)/i);
  if (height && Number(height[1]) >= 50 && Number(height[1]) <= 250) patch.heightCm = height[1];
  if (Object.keys(patch).length) return { kind: "PROFILE", patch };
  const gear = q.match(/(?:我的)?器材(?:是|为|改为|:)\s*(没有|无器械|哑铃|健身房)/);
  if (gear)
    return {
      kind: "PROFILE",
      patch: {
        equipment: /哑铃/.test(gear[1]) ? "DUMBBELLS" : /健身房/.test(gear[1]) ? "GYM" : "NONE",
      },
    };
  if (/(?:训练日|可训练日)(?:是|为|改为|:)/.test(q)) {
    const tail = q.split(/(?:训练日|可训练日)(?:是|为|改为|:)/)[1] ?? "",
      chars = [...tail.matchAll(/(?:周|星期)?([一二三四五六日天])/g)].map((m) => m[1]);
    if (!chars.length)
      return { kind: "CLARIFY", message: "请写明可训练的星期，例如“训练日是周一、周三、周五”。" };
    return {
      kind: "PROFILE",
      patch: {
        trainingDays: [
          ...new Set(
            chars.map((c) => (c === "日" || c === "天" ? 0 : "一二三四五六".indexOf(c) + 1)),
          ),
        ],
      },
    };
  }
  const note = q.match(/(?:添加|更新|修改|设置)?(?:我的)?(?:备注|身体限制)\s*[:：为是]\s*(.+)/);
  if (note)
    return {
      kind: "PROFILE",
      patch: note[0].includes("身体限制")
        ? { limit: note[1].slice(0, 80) }
        : { note: note[1].slice(0, 120) },
    };
  if (/力量/.test(q) && /减少一组|少一组|减少1组|少1组/.test(q)) {
    const day = requestedDay(q, today);
    return {
      kind: "REDUCE_SETS",
      days: day ? [day] : weekOf(addDays(today, /下周/.test(q) ? 7 : 0)),
    };
  }
  if (/改成|改为|换成/.test(q) && /轻松跑|恢复跑/.test(q)) {
    const day = requestedDay(q, today);
    if (!day || day < today)
      return { kind: "CLARIFY", message: "要修改哪个日期的跑步课？请给出今天或未来的具体日期。" };
    return { kind: "EASY_RUN", day };
  }
  if (/疼|痛|酸/.test(q) && !/不痛|不疼|无痛|没有疼痛|没有酸痛/.test(q)) {
    const region = q.match(
      /膝盖|膝|小腿|大腿后侧|大腿|跟腱|脚踝|踝|足底|脚|腰|背|肩|肘|手腕|髋|臀|胸/,
    )?.[0];
    if (!region)
      return { kind: "CLARIFY", message: "哪个部位、哪一侧不舒服？是否影响走路或正常动作？" };
    const severity = q.match(/(\d+(?:\.\d+)?)\s*(?:分|\/10)/),
      duration = q.match(/持续\s*(\d+(?:\.\d+)?)\s*(天|小时)/);
    return {
      kind: "SYMPTOM",
      input: {
        kind: /酸痛|酸胀/.test(q) && !/刺痛|锐痛|疼痛|疼/.test(q) ? "SORENESS" : "PAIN",
        region,
        side: /左/.test(q)
          ? "LEFT"
          : /右/.test(q)
            ? "RIGHT"
            : /双|两侧/.test(q)
              ? "BILATERAL"
              : "UNSPECIFIED",
        severity: severity && Number(severity[1]) <= 10 ? Number(severity[1]) : null,
        durationHours: duration ? Number(duration[1]) * (duration[2] === "天" ? 24 : 1) : null,
        trigger:
          q.match(/(跑步|深蹲|硬拉|走路|上下楼|跳跃|力量训练)(?:时|会|后|诱发)?/)?.[1] ?? null,
        functionImpact: /不能走|无法负重|无法行走/.test(q)
          ? "UNABLE"
          : /受限|跛行|走路痛|走路疼/.test(q)
            ? "LIMITED"
            : /不影响|正常走路/.test(q)
              ? "NORMAL"
              : "UNKNOWN",
        trend: /越来越|加重|更疼|更痛/.test(q)
          ? "WORSENING"
          : /减轻|好转/.test(q)
            ? "IMPROVING"
            : "UNKNOWN",
        notes: q,
        occurredAt: now,
        trainingRefs: [],
      },
    };
  }
  if (/修改|调整|更正|保存|记录|改为|改成|减少/.test(q))
    return {
      kind: "CLARIFY",
      message: "请写明要改的具体字段、数值或课程日期；当前尚未形成明确的变更差异。",
    };
  return { kind: "NONE" };
}
