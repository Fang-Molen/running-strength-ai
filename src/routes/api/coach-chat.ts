import { createFileRoute } from '@tanstack/react-router';
import { handleCoachHttpRequest } from '../../../server/coach-deepseek/coach-http.server';

export const Route = createFileRoute('/api/coach-chat')({
  server: { handlers: {
    GET: ({ request }) => handleCoachHttpRequest(request),
    POST: ({ request }) => handleCoachHttpRequest(request),
  } },
});
