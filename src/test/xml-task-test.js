// Test for Claude 4 XML tool call integration in Task workflow
const { parseAssistantMessageV2 } = require("../core/assistant-message/parse-assistant-message")

// Simulate Claude 4 assistant message with XML tool calls
const testAssistantMessage = `I'll help you update the test file and create a new configuration file.

<function_calls>
<invoke name="artifacts">
<parameter name="command">update</parameter>
<parameter name="id">src/test-file.ts</parameter>
<parameter name="old_str">console.log("Hello, World!");</parameter>
<parameter name="new_str">console.log("Hello, Claude 4!");</parameter>
</invoke>
</function_calls>

Now let me create a new configuration file:

<function_calls>
<invoke name="artifacts">
<parameter name="command">create</parameter>
<parameter name="id">config.json</parameter>
<parameter name="content">{
  "version": "4.0",
  "features": {
    "xmlToolCalls": true
  }
}</parameter>
</invoke>
</function_calls>

The files have been updated successfully.`

console.log("Testing Claude 4 XML tool call parsing in assistant messages...\n")

try {
	const contentBlocks = parseAssistantMessageV2(testAssistantMessage)

	console.log(`Parsed ${contentBlocks.length} content blocks:\n`)

	contentBlocks.forEach((block, index) => {
		console.log(`Block ${index + 1}:`)
		console.log(`  Type: ${block.type}`)

		if (block.type === "text") {
			console.log(`  Content: ${block.content.substring(0, 100)}${block.content.length > 100 ? "..." : ""}`)
		} else if (block.type === "tool_use") {
			console.log(`  Tool: ${block.name}`)
			console.log(`  Parameters:`, block.params)
		}

		console.log(`  Partial: ${block.partial}`)
		console.log()
	})

	// Verify the text blocks contain XML content
	const xmlBlocks = contentBlocks.filter(
		(block) =>
			block.type === "text" &&
			(block.content.includes("<function_calls>") || block.content.includes('<invoke name="artifacts">')),
	)

	console.log(`Found ${xmlBlocks.length} text blocks containing XML tool calls`)

	if (xmlBlocks.length > 0) {
		console.log("\n✅ Claude 4 XML tool calls are properly preserved in text blocks")
		console.log("These will be processed by presentAssistantMessage in the Task workflow")
	} else {
		console.log("\n❌ No XML tool calls found in text blocks")
	}
} catch (error) {
	console.error("Error parsing assistant message:", error)
}
