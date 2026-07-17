---
'ai': patch
---

fix(ai): use injective serialization for tool approval HMAC payload

The tool approval signature (`experimental_toolApprovalSecret`) built its HMAC
payload by joining fields with `\n`. Because fields such as `toolName` and
`toolCallId` can themselves contain a newline, distinct field tuples could
serialize to identical bytes, allowing a signed approval to verify against a
different tuple. The payload is now serialized with `JSON.stringify` (with a
versioned domain-separation prefix), which escapes delimiter/control characters
and makes the encoding injective.
