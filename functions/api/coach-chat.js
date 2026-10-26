// The public route uses the existing server-owned subject/snapshot/consent resolver.
// Browser facts or a local consent preference cannot authorize provider dispatch.
export { onRequestPost } from '../../server/coach-deepseek/coach-chat.controller.js';
