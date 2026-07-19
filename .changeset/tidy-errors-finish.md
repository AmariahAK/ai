---
'ai': patch
---

fix: emit a terminal finish part with `finishReason: 'error'` when `streamText` terminates on an error (failed follow-up step request, failed initial request, or a model stream that produced no output), so `result.finishReason`, `fullStream`, and UI message stream `onEnd`/`onFinish` observe the error termination instead of a stream that ends without a finish event
