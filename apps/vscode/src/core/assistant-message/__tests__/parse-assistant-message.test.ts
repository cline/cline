import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { parseAssistantMessageV2 } from "../parse-assistant-message"

describe("parseAssistantMessageV2", () => {
	it("unescapes HTML entities in execute_command commands", () => {
		const [block] = parseAssistantMessageV2(`
<execute_command>
<command>printf &quot;ok&quot; &amp;&amp; grep foo input.txt &gt; out.txt</command>
<requires_approval>false</requires_approval>
</execute_command>
`)

		assert.equal(block.type, "tool_use")
		assert.equal(block.name, "execute_command")
		assert.equal(block.params.command, 'printf "ok" && grep foo input.txt > out.txt')
		assert.equal(block.params.requires_approval, "false")
	})

	it("leaves non-command tool content untouched", () => {
		const [block] = parseAssistantMessageV2(`
<write_to_file>
<path>index.html</path>
<content>&lt;div&gt;A &amp;&amp; B&lt;/div&gt;</content>
</write_to_file>
`)

		assert.equal(block.type, "tool_use")
		assert.equal(block.name, "write_to_file")
		assert.equal(block.params.content, "&lt;div&gt;A &amp;&amp; B&lt;/div&gt;")
	})
})
