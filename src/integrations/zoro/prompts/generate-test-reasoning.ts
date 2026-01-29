export const GENERATE_TEST_REASONING_PROMPT = `
You are analyzing test results and generating detailed reasoning for each test.

**Substep Description:**
{substepDescription}

**Rules:**
{rules}

**Test Results:**
{testResults}

**Your Task:**
For each test, generate:
1. **reasoning** - Detailed explanation of what this test validates and why it matters
2. **rule_text** - Full text of the rule being tested (for rule tests only)
3. **feature_name** - Name of the feature being tested (for feature tests only)

**Output Format:**
Return a JSON array with one object per test:

\`\`\`json
[
  {
    "test_name": "test_feature_basic_functionality",
    "reasoning": "This test validates that the core feature works correctly by checking X. It matters because Y.",
    "feature_name": "Basic Functionality"
  },
  {
    "test_name": "test_rule_1_followed",
    "reasoning": "This test ensures that rule 1 is followed by verifying X. This prevents Y and ensures Z.",
    "rule_text": "Full text of rule 1 from the rules list",
    "rule_id": "rule-id-123"
  },
  {
    "test_name": "test_integration_with_api",
    "reasoning": "This test validates integration with the external API by checking X. It matters because Y."
  },
  {
    "test_name": "test_edge_case_null_input",
    "reasoning": "This test ensures robust error handling when receiving null input. It prevents crashes and ensures graceful degradation."
  }
]
\`\`\`

**Guidelines:**
- Be specific about what each test validates
- Explain WHY the test matters (what could go wrong without it)
- For rule tests: include the full rule text
- For feature tests: include a clear feature name
- Keep reasoning concise but informative (2-3 sentences)
- Match test_name exactly to the test results provided

Generate ONLY the JSON array, no markdown formatting.
`

export function buildGenerateTestReasoningPrompt(
	substepDescription: string,
	rules: Array<{ rule_id: string; description: string }>,
	testResults: Array<{ name: string; category: string; status: string; rule_id?: string }>,
): string {
	const rulesText = rules.map((r, i) => `${i + 1}. [${r.rule_id}] ${r.description}`).join("\n")
	const testResultsText = JSON.stringify(testResults, null, 2)

	return GENERATE_TEST_REASONING_PROMPT.replace("{substepDescription}", substepDescription)
		.replace("{rules}", rulesText)
		.replace("{testResults}", testResultsText)
}
