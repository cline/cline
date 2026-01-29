export const GENERATE_TESTS_PROMPT = `
You are generating comprehensive Python unit tests for a substep implementation.

**Substep Description:**
{substepDescription}

**Rules to Validate:**
{rules}

**Verification Data (what was implemented):**
{verificationData}

**Your Task:**
Generate Python unit tests that comprehensively validate this substep across 4 categories:

1. **Feature Tests** - Does the core functionality work correctly?
2. **Rule Compliance Tests** - Is each rule followed? (one test per rule)
3. **Integration Tests** - Does it work with other project components?
4. **Edge Case Tests** - Error handling, boundaries, null/empty inputs, unexpected states

**Output Format:**
Generate Python code using the unittest framework. Each test must print a TEST_RESULT line:

\`\`\`python
import unittest

class TestSubstep(unittest.TestCase):
    
    def test_feature_basic_functionality(self):
        """Test that the main feature works"""
        # Your test code here
        result = some_function()
        self.assertTrue(result)
        print("TEST_RESULT:PASS:feature:test_feature_basic_functionality")
    
    def test_rule_1_followed(self):
        """Test that rule 1 is followed"""
        # Your test code here
        print("TEST_RESULT:PASS:rule:test_rule_1_followed:rule-id-123")
    
    def test_integration_with_api(self):
        """Test integration with external API"""
        # Your test code here
        print("TEST_RESULT:PASS:integration:test_integration_with_api")
    
    def test_edge_case_null_input(self):
        """Test handling of null input"""
        # Your test code here
        print("TEST_RESULT:PASS:edge_case:test_edge_case_null_input")

if __name__ == '__main__':
    unittest.main()
\`\`\`

**TEST_RESULT Format:**
\`TEST_RESULT:<STATUS>:<CATEGORY>:<TEST_NAME>[:<RULE_ID>]\`

- STATUS: PASS or FAIL
- CATEGORY: feature, rule, integration, or edge_case
- TEST_NAME: descriptive test name
- RULE_ID: (optional) only for rule tests

**Requirements:**
- Generate AT LEAST one test per category
- For rule tests: create one test per rule provided
- Use descriptive test names
- Include brief docstrings
- Print TEST_RESULT for every test
- Make tests executable and realistic
- Import necessary modules from the project

Generate ONLY the Python code, no markdown formatting.
`

export function buildGenerateTestsPrompt(
	substepDescription: string,
	rules: Array<{ rule_id: string; description: string }>,
	verificationData: any,
): string {
	const rulesText = rules.map((r, i) => `${i + 1}. [${r.rule_id}] ${r.description}`).join("\n")
	const verificationText = JSON.stringify(verificationData, null, 2)

	return GENERATE_TESTS_PROMPT.replace("{substepDescription}", substepDescription)
		.replace("{rules}", rulesText)
		.replace("{verificationData}", verificationText)
}
