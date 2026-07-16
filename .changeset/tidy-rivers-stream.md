---
'ai': patch
---

Add a per-step `firstChunkMs` timeout for streaming generations that waits for parsed content-bearing output independently from the timeout between later chunks.
