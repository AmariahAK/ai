---
"ai": patch
---

Flush Node.js response chunks when piping streams so Express compression does not buffer AI SDK streams until completion.
