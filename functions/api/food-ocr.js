// 饮食拍照识别代理：只接收本机 OCR 得到的营养标签/小票文字（不接收图片），交给 DeepSeek 整理成字段。密钥只在服务端（DEEPSEEK_API_KEY），不记录内容。
const KEYS = ["name", "brand", "basis", "servingGrams", "kcal", "protein", "carb", "fat", "fiber"];
const PROMPT = `下面是食品包装营养成分表或小票照片经本机OCR得到的文字（可能有错字、错行）。只提取文字中明确出现的信息，输出JSON，键：name(食品名称), brand(品牌), basis("100g"=每100克/毫升, "serv"=每份, "this"=整份/本次), servingGrams(每份克数), kcal(能量千卡；只有千焦时除以4.184), protein(蛋白质g), carb(碳水化合物g), fat(脂肪g，不是饱和脂肪), fiber(膳食纤维g)。没有的项填null，不要估算或补全。只输出JSON。\n\nOCR文字：\n`;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function onRequestPost({ request, env }) {
  if (!env.DEEPSEEK_API_KEY) return json({ error: "在线识别服务未配置" }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const text = typeof body?.text === "string" ? body.text.slice(0, 4000) : "";
  if (!text.trim()) return json({ error: "没有可识别的文字" }, 400);
  const ask = async (strict) => {
    const r = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({ model: env.FOOD_OCR_MODEL || env.SCALE_OCR_MODEL || "deepseek-chat", temperature: 0, ...(strict ? { response_format: { type: "json_object" } } : {}),
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
