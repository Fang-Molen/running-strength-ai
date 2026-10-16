// Missing hashed chunks must 404, never fall back to index.html.
export async function onRequest({ request, env }) {
  const res = await env.ASSETS.fetch(request)
  if ((res.headers.get("content-type") || "").includes("text/html")) return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } })
  return res
}
