import { createFileRoute } from '@tanstack/react-router';
import { handleCoachHttpRequest } from '../../../server/coach-deepseek/coach-http.server';

export const Route = createFileRoute('/api/coach-snapshot')({
  server: { handlers: {
    POST: ({ request }) => handleCoachHttpRequest(request),
    DELETE: ({ request }) => handleCoachHttpRequest(request),
  } },
});
