// The static Pages frontend uses the same authenticated Node backend for sessions.
import { proxyCoachBackend } from '../coach-backend.js';
export const onRequestGet = proxyCoachBackend;
export const onRequestPost = proxyCoachBackend;
