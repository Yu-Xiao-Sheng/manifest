---
'manifest': patch
---

Fix ChatGPT Responses API tool call support in the Manifest proxy adapter.

Requests now forward tool definitions and tool choice settings to the Responses API,
replay assistant tool calls and tool outputs across turns, and map both non-streaming
and streaming function call events back into OpenAI-compatible `tool_calls`.
