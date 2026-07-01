---
"@cline/shared": patch
"@cline/llms": patch
---

fix: don't send image content to models without image capability

Image blocks left in the conversation (from a paste or a tool result such
as `read_files` on an image) were sent to text-only models like Z.AI
GLM-5.2, which reject the whole request with
`messages.content.type is invalid, allowed values: ['text']`. Image parts
are now omitted (replaced with a text placeholder) when the selected
model lacks the `images` capability; vision models are unaffected.
