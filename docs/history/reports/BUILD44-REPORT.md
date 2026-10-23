# BUILD 44 Cross-browser image-entry candidate

Source: BUILD 43 candidate. No deployment or historical data migration.

Implemented: capability detection (file input, native TextDetector, image bitmap, IndexedDB, service worker, WASM, crypto); browser-agnostic entry explanation in device evidence UI; explicit manual fallback and per-browser data isolation warning. No remote calls or secrets.

Tests: `node --experimental-strip-types --test src/lib/core/browser-capabilities.test.ts src/lib/core/local-ocr-policy.test.ts` => 9/9 PASS.

NOT IMPLEMENTED: bundled offline WASM OCR engine, handwriting recognition, cross-browser E2E, complete typecheck/build, actual device verification, multi-browser data synchronization. Native OCR availability is feature detected, not guaranteed by brand. No changes to safety gates, canonical training or automatic decisions.
