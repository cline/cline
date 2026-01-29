import { EnforcementResponse } from "../types"

export function getExecuteTestPrompt(
	verificationResult: EnforcementResponse,
	stepDescription: string,
	substepDescription: string | undefined,
	workspaceDir: string,
	testFilePath: string,
	chatId: string,
	nodeId: string,
	substepId?: string,
): string {
	const rules = verificationResult.rules_analysis || []
	const filesSummary = verificationResult.files_summary || []

	let prompt = `# Task: Generate and Run Comprehensive Tests

## Current Implementation Status: ${verificationResult.verdict}

${stepDescription ? `## Step Description\n${stepDescription}\n` : ""}
${substepDescription ? `## Substep Description\n${substepDescription}\n` : ""}

## Overview of What Was Implemented
${verificationResult.overview}

## Test File Path
**Write tests to**: \`${testFilePath}\`

## Workspace Context
**Workspace root**: \`${workspaceDir}\`
**Execute tests FROM**: \`${workspaceDir}\` (for proper imports)

`

	if (rules.length > 0) {
		prompt += `## Rules to Test (${rules.length})

Test that each of these rules is properly implemented:

${rules
	.map(
		(rule, i) => `
### ${i + 1}. ${rule.rule_text}
- **Rule ID**: ${rule.rule_id}
- **Current Status**: ${rule.followed ? "✅ FOLLOWED" : "❌ NOT FOLLOWED"}
- **Evidence**: ${rule.evidence || "No evidence"}

**Test this by**: Verifying the implementation matches the rule's requirement
`,
	)
	.join("\n")}

`
	}

	if (filesSummary.length > 0) {
		prompt += `## Files That Were Changed

${filesSummary
	.map(
		(file, i) => `
### ${i + 1}. ${file.path}
- **Lines changed**: ${file.lines_changed || "unknown"}
- **Changes**: ${file.changes}
- **Purpose**: ${file.impact}
`,
	)
	.join("\n")}

`
	}

	prompt += `
## Instructions for Test Generation

### Phase 1: Write and Run Tests

1. **Import Setup - Use EXACTLY This Code**:
   Copy this import block exactly as shown. Do not modify or add to it:
   \`\`\`python
   import sys
   import os
   
   # Add workspace root to path (this line only, no other sys.path modifications)
   sys.path.insert(0, '${workspaceDir}')
   \`\`\`
   
   ⚠️ **CRITICAL**: This single sys.path.insert enables imports like:
   - \`from backend.api.routes import ...\`
   - \`from backend.schemas import ...\`
   - \`from backend.storage import ...\`
   
   **Do NOT add additional sys.path entries** (like \`sys.path.insert(0, '${workspaceDir}/backend')\`) - this will break imports!

2. **Test Categories**:
   - **Unit tests**: Test individual functions/methods
   - **Integration tests**: Test component interactions
   - **Rule compliance tests**: Verify each rule is followed
   - **Feature tests**: Verify substep features work correctly

3. **Test Output Format**:
   Each test MUST print results in this format:
   \`\`\`
   TEST_RESULT: {
     "name": "test_feature_name",
     "status": "passed" | "failed",
     "description": "What this test verifies",
     "rule_id": "rule-id-if-applicable",
     "feature_name": "Feature being tested"
   }
   \`\`\`

4. **Write the test file** to: \`${testFilePath}\`
   - Use pytest or unittest
   - Import relevant code from the workspace
   - Add comprehensive assertions
   - Print TEST_RESULT for each test

5. **Run the tests**: Execute \`python ${testFilePath}\` from workspace root

6. **Capture output**: Note all TEST_RESULT entries and any errors

### Phase 2: Structured Report (Next Phase)

After running tests, you will be asked to provide a JSON report with:
- test_file: path to the test file
- results: array of test results with reasoning

## Available Tools

- **read_file**: Read files to understand implementation
- **write_to_file**: Create the test file
- **execute_command**: Run the tests
- **search_files**: Find related code

## Goal

Generate comprehensive tests that:
1. Verify all rules are followed
2. Test all features mentioned in the substep
3. Provide clear evidence of correctness
4. Help identify any remaining issues

Start by brainstorming test cases, then write the test file, then run it!
`

	return prompt
}
