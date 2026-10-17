// t438 体脂秤图片识别代理。密钥只在服务端环境变量里（GEMINI_API_KEY 或 XAI_API_KEY），不记录图片和密钥。
const PROMPT = `这是体脂秤App截图或体脂秤显示屏照片。只读取图中明确显示的数值，输出JSON，键：weight(kg), fat(体脂率%), muscle(肌肉量kg), armMuscle(双臂肌肉kg), trunkMuscle(躯干肌肉kg), legMuscle(双腿肌肉kg), visceral(内脏脂肪等级), waterRate(水分%), boneMass(骨量kg), bmr(基础代谢kcal), date(YYYY-MM-DD)。图中没有的项填null，不要估算。斤要换算成kg。只输出JSON。`;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY && !env.XAI_API_KEY) return json({ error: "在线识别服务未配置" }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: "请求格式错误" }, 400); }
  const img = String(body?.image || ""); const m = img.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m || img.length > 4_000_000) return json({ error: "图片格式不支持或过大" }, 400);
  try {
    let text = "";
    if (env.GEMINI_API_KEY) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.SCALE_OCR_MODEL || "gemini-2.5-flash"}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: `image/${m[1]}`, data: m[2] } }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }) });
      if (!r.ok) return json({ error: `识别服务返回 ${r.status}` }, 502);
      text = (await r.json())?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    } else {
      const r = await fetch("https://api.x.ai/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.XAI_API_KEY}` },
        body: JSON.stringify({ model: env.SCALE_OCR_MODEL || "grok-4", temperature: 0, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: img } }, { type: "text", text: PROMPT }] }] }) });
      if (!r.ok) return json({ error: `识别服务返回 ${r.status}` }, 502);
      text = (await r.json())?.choices?.[0]?.message?.content || "";
    }
    const s = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return json({ result: JSON.parse(s) });
  } catch { return json({ error: "识别失败，请重试或手动填写" }, 502); }
}
