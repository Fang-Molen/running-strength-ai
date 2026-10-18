export function trainingExecutionOpen(events: { event_type: string; payload?: { sessionId?: string } | null }[]): boolean {
  const open = new Set<string>()
  for (const event of events) {
    const sessionId = event.payload?.sessionId
    if (!sessionId) continue
    if (event.event_type === "TRAINING_STARTED") open.add(sessionId)
    if (event.event_type === "TRAINING_COMPLETED" || event.event_type === "TRAINING_INTERRUPTED") open.delete(sessionId)
  }
  return open.size > 0
}

export function serviceWorkerNavigationPlan(input: {
  hasController: boolean
  alreadyReloaded: boolean
  trainingOpen: boolean
}): { reload: boolean; prefetch: boolean } {
  if (input.trainingOpen) return { reload: false, prefetch: input.hasController }
  if (!input.hasController && !input.alreadyReloaded) return { reload: true, prefetch: false }
  return { reload: false, prefetch: input.hasController }
}

/** Dynamic route chunks can finish loading before the worker controls this tab. */
export function offlinePrefetchUrls(origin: string, documentUrls: string[], resourceUrls: string[]): string[] {
  const parse = (value: string) => {try {return new URL(value, origin)} catch {return null}}
  const loadedChunks = resourceUrls.filter(value => {
    const url = parse(value)
    return url?.origin === origin && url.pathname.startsWith('/assets/') && /\.(?:m?js|css)$/.test(url.pathname)
  })
  return [...new Set([...documentUrls, ...loadedChunks, '/'].flatMap(value => {
    const url = parse(value)
    return url?.origin === origin && !url.pathname.startsWith('/api') && !url.pathname.includes('/_server') ? [url.href] : []
  }))]
}
