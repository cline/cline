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
		POST: ["/chat/completions", "/auth/token", "/auth/register", "/users/me/budget/request"],
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

/**
 * Structured `editor` tool call streamed in response to the `edit_request` prompt.
 *
 * The SDK runtime only executes structured (OpenAI-format) tool calls — unlike
 * the classic extension, it does not parse XML-style tool syntax (e.g.
 * `<replace_in_file>`) out of assistant text. The mock server streams this as
 * `choices[].delta.tool_calls[]` deltas followed by `finish_reason: "tool_calls"`.
 *
 * The `path` is workspace-relative; the SDK editor executor resolves relative
 * paths against the session cwd, which is the first workspace folder in both
 * the single-root and multi-root e2e workspaces (`fixtures/workspace`).
 */
export const E2E_MOCK_EDITOR_TOOL_CALL = {
	id: "call_e2e_edit_1",
	name: "editor",
	arguments: {
		path: "test.ts",
		old_text: 'export const name = "john"',
		new_text: 'export const name = "cline"',
	},
}

const edit_request_complete = `I successfully replaced "john" with "cline" in the test.ts file. The change has been completed and the file now contains:

\`\`\`typescript
export const name = "cline"
\`\`\`

The change has been applied and saved to the file.`

export const E2E_MOCK_API_RESPONSES = {
	DEFAULT: "Hello! I'm a mock Cline API response.",
	/** Assistant text streamed before the structured editor tool call. */
	EDIT_REQUEST_LEAD_IN: `I'll replace "john" with "cline" in the test.ts file.`,
	/** Turn-ending text streamed after the SDK reports the editor tool result. */
	EDIT_REQUEST_COMPLETE: edit_request_complete,
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
			id: "anthropic/claude-sonnet-4.6",
			name: "anthropic/claude-sonnet-4.6",
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
		id: "anthropic/claude-sonnet-4.6",
		name: "anthropic/claude-sonnet-4.6",
		description: "Recommended model for e2e onboarding",
		context_length: 200_000,
		top_provider: {
			max_completion_tokens: 64_000,
			context_length: 200_000,
			is_moderated: false,
		},
		architecture: {
			modality: "text->text",
		},
		pricing: {
			prompt: "0.000003",
			completion: "0.000015",
			input_cache_read: "0.0000003",
			input_cache_write: "0.00000375",
		},
		supported_parameters: ["include_reasoning"],
	},
]
