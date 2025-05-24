// Test for Claude 4 XML tool call handling
const { handleTextEditorTool } = require("../core/assistant-message/diff")

// Test XML tool call examples
const testCases = [
	{
		name: "Update command (replace_in_file)",
		xml: `<function_calls>
<invoke name="artifacts">
<parameter name="command">update</parameter>
<parameter name="id">src/test-file.ts</parameter>
<parameter name="old_str">console.log("Hello, World!");</parameter>
<parameter name="new_str">console.log("Hello, Claude 4!");</parameter>
</invoke>
</function_calls>`,
		originalContent: `function main() {
    console.log("Hello, World!");
}`,
		expectedResult: `function main() {
    console.log("Hello, Claude 4!");
}`,
	},
	{
		name: "Rewrite command (write_to_file)",
		xml: `<function_calls>
<invoke name="artifacts">
<parameter name="command">rewrite</parameter>
<parameter name="id">src/test-file.ts</parameter>
<parameter name="content">// This is a completely new file
console.log("Rewritten file");</parameter>
</invoke>
</function_calls>`,
		originalContent: "Old content",
		expectedResult: `// This is a completely new file
console.log("Rewritten file");`,
	},
	{
		name: "Create command",
		xml: `<function_calls>
<invoke name="artifacts">
<parameter name="command">create</parameter>
<parameter name="id">src/new-file.ts</parameter>
<parameter name="content">// New file created with Claude 4
export function hello() {
    return "Hello from Claude 4!";
}</parameter>
</invoke>
</function_calls>`,
		originalContent: undefined,
		expectedResult: `// New file created with Claude 4
export function hello() {
    return "Hello from Claude 4!";
}`,
	},
	{
		name: "Multiline update command",
		xml: `<function_calls>
<invoke name="artifacts">
<parameter name="command">update</parameter>
<parameter name="id">src/test-file.ts</parameter>
<parameter name="old_str">function old() {
    // Old implementation
    return "old";
}</parameter>
<parameter name="new_str">function updated() {
    // New implementation
    return "updated";
}</parameter>
</invoke>
</function_calls>`,
		originalContent: `// File header
function old() {
    // Old implementation
    return "old";
}

// File footer`,
		expectedResult: `// File header
function updated() {
    // New implementation
    return "updated";
}

// File footer`,
	},
]

async function runTests() {
	console.log("Running Claude 4 XML tool call tests...\n")

	let passed = 0
	let failed = 0

	for (const testCase of testCases) {
		console.log(`Test: ${testCase.name}`)
		console.log("-".repeat(50))

		try {
			const result = await handleTextEditorTool(testCase.xml, {}, testCase.originalContent)

			if (result.trim() === testCase.expectedResult.trim()) {
				console.log("✅ PASSED")
				passed++
			} else {
				console.log("❌ FAILED")
				console.log("Expected:")
				console.log(testCase.expectedResult)
				console.log("\nActual:")
				console.log(result)
				failed++
			}
		} catch (error) {
			console.log("❌ FAILED with error:")
			console.log(error.message)
			console.log(error.stack)
			failed++
		}

		console.log("\n")
	}

	console.log("=".repeat(50))
	console.log(`Test Results: ${passed} passed, ${failed} failed`)
	console.log("=".repeat(50))
}

// Run the tests
runTests().catch(console.error)
