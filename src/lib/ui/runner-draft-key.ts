/** Calendar slot IDs contain colons. Keep their UI drafts out of the legacy
 * fr255-only export validator; the complete vault still backs up every key.
 * Existing legacy session draft identities remain unchanged. */
export function runnerDraftKey(decisionId: string, sessionId: string, setKey: string) {
  const prefix = sessionId.startsWith('scheduled:') ? 'fk-runner-draft-v71' : 'fr255-runner-draft-v1';
  return `${prefix}:${decisionId}:${sessionId}:${setKey}`;
}
