# BUILD 43 — Local OCR safety hardening (candidate)

Source: BUILD 42 candidate. No deployment or canonical training/history modifications.

Changes:
- Explicit offline OCR availability and image admission policy.
- Reject unsupported and oversized images before processing.
- Switching source images now clears stale recognized/transcribed text, preventing evidence from an earlier image being attributed to the next image.
- Empty OCR output preserves manually entered text.
- OCR confidence explicitly unavailable; native TextDetector does not supply a calibrated confidence score.
- UI clarifies browser-dependent OCR, unreliable handwriting recognition, and no visual understanding.

Tests: 5/5 targeted Node tests PASS (BUILD43-TESTS.log). Full project typecheck, production build, browser and iPhone tests NOT RUN; no OCR engine bundled, no guaranteed OCR on iOS, no network OCR implemented. This is a safety/UX increment, not a complete OCR feature.

Next: evaluate bundling a licensed offline WASM OCR engine with explicit asset size and CSP verification, browser E2E with IndexedDB, controlled plan transaction integration tests, then optional server-side consent-gated vision. No front-end secrets.
