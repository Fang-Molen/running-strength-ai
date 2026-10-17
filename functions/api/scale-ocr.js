// t438 体脂秤识别代理：只接收本机 OCR 得到的文字（不接收图片），交给 DeepSeek 整理成字段。密钥只在服务端（DEEPSEEK_API_KEY），不记录内容。
const PROMPT = `下面是体脂秤App截图或秤显示屏照片经本机OCR得到的文字（可能有错字、错行）。只提取文字中明确出现的数值，输出JSON，键：weight(kg), fat(体脂率%), muscle(肌肉量kg，不是肌肉率), armMuscle(双臂肌肉kg), trunkMuscle(躯干肌肉kg), legMuscle(双腿肌肉kg), visceral(内脏脂肪等级), waterRate(水分%), boneMass(骨量kg), bmr(基础代谢kcal), date(YYYY-MM-DD)。没有的项填null，不要估算；斤换算成kg。只输出JSON。\n\nOCR文字：\n`;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function onRequestPost({ request, env }) {
  if (!env.DEEPSEEK_API_KEY) return json({ error: "在线识别服务未配置" }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const text = typeof body?.text === "string" ? body.text.slice(0, 4000) : "";
  if (!text.trim()) return json({ error: "没有可识别的文字" }, 400);
  const KEYS = ["weight", "fat", "muscle", "armMuscle", "trunkMuscle", "legMuscle", "visceral", "waterRate", "boneMass", "bmr", "date"];
  const ask = async (strict) => {
    const r = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({ model: env.SCALE_OCR_MODEL || "deepseek-chat", temperature: 0, ...(strict ? { response_format: { type: "json_object" } } : {}),
        messages: [{ role: "system", content: "你是数据提取工具，只输出一个JSON对象，键名必须是：" + KEYS.join(", ") }, { role: "user", content: PROMPT + text }] }) });
    if (!r.ok) throw Object.assign(new Error("upstream"), { status: r.status });
    const out = (await r.json())?.choices?.[0]?.message?.content || "";
    const o = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    return KEYS.some(k => k in o) ? o : null;
  };
  try {
    let o = await ask(true).catch(e => { if (e.status) throw e; return null; });
    if (!o) o = await ask(false);
    if (!o) return json({ error: "识别服务没有返回有效字段" }, 502);
    return json({ result: o });
  } catch (e) { return json({ error: e?.status ? `识别服务返回 ${e.status}` : "识别失败，请重试或手动填写" }, 502); }
}
