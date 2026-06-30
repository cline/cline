export const E2E_REGISTERED_MOCK_ENDPOINTS = {
	"/api/v1": {
		GET: [
			"/generation",
			"/ai/cline/models",
			"/ai/cline/recommended-models",
			"/organizations/{orgId}/balance",
			"/organizations/{orgId}/members/{memberId}/usages",
			"/organizations/{orgId}/api-keys",
			"/organizations/{orgId}/remote-config",
			"/users/me",
			"/users/me/featurebase-token",
			"/users/{userId}/balance",
			"/users/{userId}/usages",
			"/users/{userId}/payments",
		],
		POST: ["/chat/completions", "/auth/token", "/users/me/budget/request"],
		PUT: ["/users/active-account"],
	},
	"/.test": {
		GET: [],
		POST: ["/auth", "/setUserBalance", "/setUserHasOrganization", "/setOrgBalance", "/setSpendLimitExceeded"],
		PUT: [],
	},
	"/health": {
		POST: [],
		GET: ["/", "/ping"],
		PUT: [],
	},
}

const replace_in_file = `I successfully replaced "john" with "cline" in the test.ts file. The change has been completed and the file now contains:

\`\`\`typescript
export const name = "cline"
\`\`\`

The TypeScript errors shown in the output are unrelated to this change - they appear to be existing issues in the broader codebase related to missing type definitions and dependencies. The specific task of updating the name in test.ts has been completed successfully.

<attempt_completion>
<result>
I have successfully replaced the name "john" with "cline" in the test.ts file. The file now exports:

\`\`\`typescript
export const name = "cline"
\`\`\`

The change has been applied and saved to the file.
</result>
</attempt_completion>`

const edit_request = `<thinking>
The user wants me to replace the name "john" with "cline" in the test.ts file. I can see the file content provided:

\`\`\`typescript
export const name = "john"
\`\`\`

I need to change "john" to "cline". This is a simple targeted edit, so I should use the replace_in_file tool rather than write_to_file since I'm only changing one small part of the file.

I need to:
1. Use replace_in_file to change "john" to "cline" in the test.ts file
2. The SEARCH block should match the exact content: \`export const name = "john"\`
3. The REPLACE block should be: \`export const name = "cline"\`
</thinking>

I'll replace "john" with "cline" in the test.ts file.

<replace_in_file>
<path>test.ts</path>
<diff>
------- SEARCH
export const name = "john"
=======
export const name = "cline"
+++++++ REPLACE
</diff>
</replace_in_file>`

export const E2E_MOCK_API_RESPONSES = {
	DEFAULT: "Hello! I'm a mock Cline API response.",
	REPLACE_REQUEST: replace_in_file,
	EDIT_REQUEST: edit_request,
}

export const E2E_MOCK_CLINE_RECOMMENDED_MODELS = {
	free: [
		{
			id: "z-ai/glm-5",
			name: "z-ai/glm-5",
			description: "Free model for e2e onboarding",
			tags: [],
		},
	],
	recommended: [
		{
			id: "anthropic/claude-sonnet-5",
			name: "anthropic/claude-sonnet-5",
			description: "Recommended model for e2e onboarding",
			tags: ["BEST"],
		},
	],
}

export const E2E_MOCK_CLINE_MODELS = [
	{
		id: "z-ai/glm-5",
		name: "z-ai/glm-5",
		description: "Free model for e2e onboarding",
		context_length: 131_072,
		top_provider: {
			max_completion_tokens: 8_192,
			context_length: 131_072,
			is_moderated: false,
		},
		architecture: {
			modality: "text->text",
		},
		pricing: {
			prompt: "0",
			completion: "0",
		},
		supported_parameters: [],
	},
	{
		id: "anthropic/claude-sonnet-5",
		name: "anthropic/claude-sonnet-5",
		description: "Recommended model for e2e onboarding",
		context_length: 200_000,
		top_provider: {
			max_completion_tokens: 128_000,
			context_length: 200_000,
			is_moderated: false,
		},
		architecture: {
			modality: "text->text",
		},
		pricing: {
			prompt: "0.000002",
			completion: "0.00001",
			input_cache_read: "0.0000002",
			input_cache_write: "0.0000025",
		},
		supported_parameters: ["include_reasoning"],
	},
]
