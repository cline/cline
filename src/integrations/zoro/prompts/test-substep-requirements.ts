export function getTestSubstepRequirementsPrompt(
	stepDescription: string,
	substepDescription: string,
	requirements: Array<{ id: string; description: string; category: string }>,
	workspaceDir: string,
	testFilePath: string,
	chatHistory: string,
	existingTestFile?: string,
): string {
	const mode = existingTestFile ? "UPDATE" : "CREATE"

	let prompt = `# Task: ${mode} Tests for Specific Requirements

## Current Mode: ${mode}

${stepDescription ? `## Step Description\n${stepDescription}\n` : ""}
${substepDescription ? `## Substep Description\n${substepDescription}\n` : ""}

## Requirements to Test (${requirements.length})

${requirements
	.map(
		(req, i) => `
### ${i + 1}. [${req.id}] ${req.description}
- **Category**: ${req.category}
- **Test Method Name**: test_${req.id.replace(/-/g, "_")}_<descriptive_name>
`,
	)
	.join("\n")}

## Test File Path
**${mode === "UPDATE" ? "Update" : "Write"} tests to**: \`${testFilePath}\`

## Workspace Context
**Workspace root**: \`${workspaceDir}\`
**Execute tests FROM**: \`${workspaceDir}\` (for proper imports)

## Chat History
${chatHistory}

`

	if (existingTestFile) {
		prompt += `## Existing Test File

\`\`\`python
${existingTestFile}
\`\`\`

## Instructions for UPDATING Test File

⚠️ **CRITICAL - Preserve Existing Structure**:

1. **Keep ALL existing code**:
   - Import statements
   - Helper functions (especially print_test_result)
   - Class definition and setUp/tearDown
   - Test methods for OTHER requirements (not in the list above)

2. **For EACH requirement in the list**:
   - Check if test method for that requirement exists (e.g., \`test_req_1_*\`)
   - If EXISTS → **REPLACE** the method with updated implementation
   - If NOT EXISTS → **ADD** new test method

3. **Test method format**:
   \`\`\`python
   def test_req_1_descriptive_name(self):
       """Requirement req-1: Description here"""
       try:
           # Test implementation
           self.assertEqual(actual, expected)
           
           # REQUIRED: Print on success
           print_test_result(
               name="test_req_1_descriptive_name",
               requirement_id="req-1",  # ← CRITICAL!
               status="pass",
               description="What was verified",
               category="${requirements[0]?.category || "feature"}"
           )
       except AssertionError as e:
           # REQUIRED: Print on failure
           print_test_result(
               name="test_req_1_descriptive_name",
               requirement_id="req-1",
               status="fail",
               description=str(e),
               category="${requirements[0]?.category || "feature"}"
           )
           raise
   \`\`\`

4. **Write the complete updated file** to: \`${testFilePath}\`

`
	} else {
		prompt += `## Instructions for CREATING New Test File

**You must write a complete test file with this structure**:

\`\`\`python
import sys
import os
import json
import unittest

# Add workspace root to path
sys.path.insert(0, '${workspaceDir}')
# Add other paths if needed (analyze implementation files first!)
# sys.path.insert(0, '${workspaceDir}/backend')
# sys.path.insert(0, '${workspaceDir}/src')

# Helper function to print structured test results
def print_test_result(name, status, description, category="general",
                      requirement_id=None, rule_description=None, feature_name=None):
    """Print test result in format that Zoro can parse"""
    result = {
        "name": name,
        "status": status,  # Must be 'pass', 'fail', or 'error'
        "description": description,
        "category": category,
        "output": "",
        "test_code": ""
    }
    if requirement_id:
        result["requirement_id"] = requirement_id
    if rule_description:
        result["rule_description"] = rule_description
    if feature_name:
        result["feature_name"] = feature_name
    print(f"TEST_RESULT: {json.dumps(result)}")

# Import from workspace (analyze implementation first!)
# from backend.api.routes import ...
# from src.components import ...

class TestSubstep(unittest.TestCase):
    """Tests for substep requirements"""
    
    def test_req_1_example(self):
        """Requirement req-1: Description"""
        try:
            # Test code here
            self.assertEqual(actual, expected)
            
            print_test_result(
                name="test_req_1_example",
                requirement_id="req-1",  # ← CRITICAL!
                status="pass",
                description="What was verified",
                category="feature"
            )
        except AssertionError as e:
            print_test_result(
                name="test_req_1_example",
                requirement_id="req-1",
                status="fail",
                description=str(e),
                category="feature"
            )
            raise

if __name__ == '__main__':
    unittest.main()
\`\`\`

**Generate test methods for ALL requirements listed above.**

`
	}

	prompt += `
## Available Tools

- **read_file**: Read implementation files to understand code
- **write_to_file**: ${mode === "UPDATE" ? "Update" : "Create"} the test file
- **search_files**: Find related code
- **execute_command**: Run commands (git, grep, etc.)

## Instructions - YOU MUST USE TOOLS

⚠️ **DO NOT JUST RESPOND - YOU MUST USE TOOLS TO COMPLETE THIS TASK**

### Step 1: Investigate Implementation (use tools!)

Before writing tests, you MUST understand the implementation:
- Use **read_file** to read implementation files mentioned in chat history
- Use **search_files** to find where requirements are implemented
- Examine the actual code to understand what to test

### Step 2: Write Test File (use write_to_file!)

Once you understand the implementation:
- Use **write_to_file** to ${mode === "UPDATE" ? "update" : "create"}: \`${testFilePath}\`
- Include test methods following the format shown above
- **Maximum 3 test methods per requirement** (prefer just 1 unless absolutely necessary)
- Each test must include requirement_id in print_test_result()
- Use clear test names: test_req_{id}_<descriptive_name>

⚠️ IMPORTANT: Most requirements should have exactly ONE test method. Only create 2-3 tests if the requirement genuinely needs to test multiple distinct scenarios (e.g., success case + error handling + edge case). Avoid creating redundant tests.

### Step 3: Done

After you write the test file, you're done. The test will be run automatically.

**START NOW by using read_file to examine the implementation files!**
`

	return prompt
}