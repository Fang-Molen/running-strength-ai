// @ts-nocheck
// 方坤联网分析代理：客户端发送去标识化的训练事实 + 问题，服务端用 DEEPSEEK_API_KEY 调用 DeepSeek。密钥只在服务端，不记录内容。
// 限制：请求体 ≤ 24KB；每个 IP 每分钟 ≤ 8 次、每天 ≤ 300 次（单实例内存计数，尽力而为）。
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const hits = new Map();
function limited(ip) {
  const now = Date.now(), h = hits.get(ip) ?? { m: [], d: 0, day: new Date().toISOString().slice(0, 10) };
  const today = new Date().toISOString().slice(0, 10); if (h.day !== today) { h.day = today; h.d = 0; }
  h.m = h.m.filter(t => now - t < 60000);
  if (h.m.length >= 8 || h.d >= 300) { hits.set(ip, h); return true; }
  h.m.push(now); h.d++; hits.set(ip, h); if (hits.size > 5000) hits.clear(); return false;
}
const SYSTEM = `你是“方坤”，一位经验丰富的短跑/400米专项教练，正在指导一名业余运动员（目标：400米跑进53秒多，12月28日最终测试）。
说话规则（必须遵守）：
1. 用平实的中文，像成熟教练当面说话。先给结论，再讲生理原因，最后给具体的下一课处方（距离×组数、配速/用时、休息、强度RPE）。
2. 一切分析要对照目标（400米53秒多）和当前训练计划来说。
3. 不要说“数据不足无法判断”“需要更多证据”这类空话。数据不够时，先基于已有事实给出最可能的判断，再明确说出要做什么测试、记录什么数据（例如“下次跑完记下每个400的成绩和组间休息”）。
4. 不使用术语堆砌和免责声明；不要说“可撤回”“候选”“审计”“已批准原课程”等系统用语。
5. 安全：出现胸痛、晕厥、呼吸困难、心悸、急性受伤或剧烈疼痛等，先让对方停止训练并就医，不给训练处方。疼痛时不建议加量。
6. 你只给建议，不会自动修改用户的训练计划；如建议调整计划，告诉用户可以在计划页自己改。
7. 只用下面“事实”里的数据，不编造成绩、心率或分段；回答控制在 350 字以内，分段清楚。`;
const clip = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
export async function onRequestPost({ request, env }) {
  if (!env.DEEPSEEK_API_KEY) return json({ error: "联网分析服务未配置" }, 503);
  const len = Number(request.headers.get("content-length") || 0); if (len > 24000) return json({ error: "内容过长" }, 413);
  const ip = request.headers.get("cf-connecting-ip") || "anon"; if (limited(ip)) return json({ error: "请求太频繁，请稍后再试" }, 429);
  let body; try { const raw = await request.text(); if (raw.length > 24000) return json({ error: "内容过长" }, 413); body = JSON.parse(raw); } catch { return json({ error: "请求格式错误" }, 400); }
  const question = clip(body?.question, 1000).trim(); if (!question) return json({ error: "没有问题" }, 400);
  const facts = clip(body?.facts, 8000), local = clip(body?.local, 3000);
  const history = Array.isArray(body?.history) ? body.history.slice(-6).map(m => ({ role: m?.role === "user" ? "user" : "assistant", content: clip(m?.text, 400) })).filter(m => m.content) : [];
  const messages = [{ role: "system", content: SYSTEM },
    ...history,
    { role: "user", content: `事实（来自用户本机记录，已去除账号与位置）：\n${facts || "（无）"}\n\n本地规则引擎的参考结论（可采纳或修正，但不要与事实矛盾）：\n${local || "（无）"}\n\n问题：${question}` }];
  try {
    const r = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({ model: env.COACH_MODEL || "deepseek-chat", temperature: 0.4, max_tokens: 900, messages }) });
    if (!r.ok) return json({ error: `联网分析服务返回 ${r.status}` }, 502);
    const out = (await r.json())?.choices?.[0]?.message?.content || "";
    if (!out.trim()) return json({ error: "联网分析没有返回内容" }, 502);
    return json({ text: out.slice(0, 4000), model: env.COACH_MODEL || "deepseek-chat" });
  } catch { return json({ error: "联网分析失败" }, 502); }
}
