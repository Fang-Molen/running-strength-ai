// @ts-nocheck
// 食物联网估算：只接收食物名称 + 份量文字（不接收图片、不接收账号），交给 DeepSeek 按常见做法估算。结果在 App 里标“联网估算·待核”，用户可改。密钥只在服务端。
const KEYS = ["name", "unit", "grams", "kcal", "protein", "carb", "fat", "fiber", "note"];
const PROMPT = `估算下面这份中国常见食物的营养（按常见做法、常见份量）。输出JSON，键：name(规范名称), unit(份量单位，如 个/份/笼/碗/杯), grams(这一份约多少克，整数), kcal(这一份的千卡), protein, carb, fat, fiber(这一份的克数，保留1位小数)，note(一句话说明按什么做法/份量估算)。不确定的营养项填null，不要编造精确值。食物：`;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const hits = new Map();
const limited = (ip) => { const now = Date.now(), w = (hits.get(ip) || []).filter(t => now - t < 60_000); w.push(now); hits.set(ip, w); return w.length > 20; };
const num = (v, max) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 10) / 10 : null);
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("origin"); if (origin && origin !== new URL(request.url).origin) return json({ error: "请从方坤页面发起" }, 403);
  if (!env.DEEPSEEK_API_KEY) return json({ error: "联网估算服务未配置" }, 503);
  if (limited(request.headers.get("cf-connecting-ip") || "x")) return json({ error: "请求太频繁，稍后再试" }, 429);
  let body; try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "", amount = typeof body?.amount === "string" ? body.amount.trim().slice(0, 30) : "";
  if (!name) return json({ error: "没有食物名称" }, 400);
  try {
    const r = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({ model: env.FOOD_ESTIMATE_MODEL || "deepseek-chat", temperature: 0, response_format: { type: "json_object" },
        messages: [{ role: "system", content: "你是营养估算工具，只输出一个JSON对象，键名必须是：" + KEYS.join(", ") }, { role: "user", content: PROMPT + name + (amount ? `（份量：${amount}）` : "") }] }) });
    if (!r.ok) return json({ error: `估算服务返回 ${r.status}` }, 502);
    const out = (await r.json())?.choices?.[0]?.message?.content || "", o = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    const result = { name: String(o.name || name).slice(0, 60), unit: String(o.unit || "份").slice(0, 4), grams: num(o.grams, 3000), kcal: num(o.kcal, 5000), protein: num(o.protein, 500), carb: num(o.carb, 800), fat: num(o.fat, 500), fiber: num(o.fiber, 200), note: String(o.note || "").slice(0, 120) };
    if (result.kcal == null) return json({ error: "估算服务没有给出热量" }, 502);
    return json({ result });
  } catch { return json({ error: "估算失败，请重试或手动填写" }, 502); }
}
