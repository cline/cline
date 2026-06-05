import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { convertO1ResponseToAnthropicMessage } from "../o1-format"

describe("convertO1ResponseToAnthropicMessage", () => {
	it("unescapes execute_command command input", () => {
		const message = convertO1ResponseToAnthropicMessage({
			id: "chatcmpl-test",
			model: "o1-test",
			choices: [
				{
					finish_reason: "stop",
					index: 0,
					message: {
						role: "assistant",
						content: `
I'll run it.

<execute_command>
<command>echo &quot;ok&quot; &amp;&amp; cat input.txt &gt; out.txt</command>
</execute_command>
`,
						refusal: null,
					},
				},
			],
			usage: {
				prompt_tokens: 1,
				completion_tokens: 1,
				total_tokens: 2,
			},
		} as any)

		const tool = message.content.find((block) => block.type === "tool_use") as any

		assert.ok(tool)
		assert.equal(tool.name, "execute_command")
		assert.equal(tool.input.command, 'echo "ok" && cat input.txt > out.txt')
	})

	it("leaves non-command tool input untouched", () => {
		const message = convertO1ResponseToAnthropicMessage({
			id: "chatcmpl-test",
			model: "o1-test",
			choices: [
				{
					finish_reason: "stop",
					index: 0,
					message: {
						role: "assistant",
						content: `
I'll write the file.

<write_to_file>
<path>snippet.txt</path>
<content>const text = &quot;ok&quot; &amp;&amp; keepHtmlEscaped;</content>
</write_to_file>
`,
						refusal: null,
					},
				},
			],
			usage: {
				prompt_tokens: 1,
				completion_tokens: 1,
				total_tokens: 2,
			},
		} as any)

		const tool = message.content.find((block) => block.type === "tool_use") as any

		assert.ok(tool)
		assert.equal(tool.name, "write_to_file")
		assert.equal(tool.input.content, "const text = &quot;ok&quot; &amp;&amp; keepHtmlEscaped;")
	})
})
