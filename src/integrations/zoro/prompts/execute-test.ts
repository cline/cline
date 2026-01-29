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

## ⚠️ CRITICAL: SINGLE FILE ONLY

**YOU MUST WRITE EXACTLY ONE TEST FILE:**
- Path: \`${testFilePath}\`
- DO NOT create additional test files
- DO NOT create helper files  
- DO NOT create __init__.py files
- ALL tests must be in this ONE file

If you create multiple files, the test execution will fail.

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

1. **Import Setup - Analyze First, Then Write**:
   
   Before writing the test, read the implementation files and check what they import. Add those directories to sys.path.
   
   \`\`\`python
   import sys
   import os
   import json
   import unittest
   
   # Add workspace root
   sys.path.insert(0, '${workspaceDir}')
   # If implementation uses 'from schemas import X', also add:
   sys.path.insert(0, '${workspaceDir}/backend')  # or /src, /app, etc.
   
   # Helper function to print structured test results
   def print_test_result(name, status, description, rule_id=None, feature_name=None):
       """Print test result in format that Zoro can parse"""
       result = {
           "name": name,
           "status": status,  # Must be 'pass', 'fail', or 'error'
           "description": description,
           "category": rule_id or feature_name or "general"  # REQUIRED field
       }
       if rule_id:
           result["rule_id"] = rule_id
       if feature_name:
           result["feature_name"] = feature_name
       print(f"TEST_RESULT: {json.dumps(result)}")
   
   # Now import from workspace
   from backend.api.routes import ...
   \`\`\`

2. **Test Categories**:
   - **Unit tests**: Test individual functions/methods
   - **Integration tests**: Test component interactions
   - **Rule compliance tests**: Verify each rule is followed
   - **Feature tests**: Verify substep features work correctly

3. **⚠️ REQUIRED: Print Results in EVERY Test**:
   
   **Every test method MUST call print_test_result():**
   \`\`\`python
   def test_feature_works(self):
       """Test that feature works correctly"""
       try:
           # Your test code
           self.assertEqual(actual, expected)
           self.assertTrue(condition)
           
           # ✅ REQUIRED: Print on success (status must be 'pass', 'fail', or 'error')
           print_test_result(
               name="test_feature_works",
               status="pass",
               description="Feature works as expected",
               rule_id="rule-abc-123",  # Optional: if testing a rule
               feature_name="Feature Name"  # Optional
           )
       except AssertionError as e:
           # ❌ REQUIRED: Print on failure
           print_test_result(
               name="test_feature_works",
               status="fail",
               description=f"Test failed: {str(e)}"
           )
           raise  # Re-raise so unittest marks it as failed
   \`\`\`
   
   **Without these print_test_result() calls, results won't appear in the Zoro UI!**

4. **Write the test file** to: \`${testFilePath}\`
   - ⚠️ CRITICAL: Write to THIS path ONLY
   - DO NOT create additional test files
   - Put ALL tests in this single file
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
