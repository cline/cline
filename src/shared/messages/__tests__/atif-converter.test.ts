import { expect } from "chai"
import type { ClineMessage } from "../../ExtensionMessage"
import type { ATIFTrajectory } from "../atif"
import { convertATIFToClineMessages, convertClineMessagesToATIF, enrichMessagesWithMetrics } from "../atif-converter"
import type { ClineStorageMessage } from "../content"

describe("ATIF Converter", () => {
	describe("convertATIFToClineMessages", () => {
		interface TestCase {
			name: string
			input: ATIFTrajectory
			expected: ClineStorageMessage[]
		}

		const testCases: TestCase[] = [
			{
				name: "Simple user-agent conversation",
				input: {
					schema_version: "ATIF-v1.3",
					session_id: "simple-session",
					agent: {
						name: "cline",
						version: "1.0.0",
					},
					steps: [
						{
							step_id: 1,
							timestamp: "2025-01-15T10:00:00Z",
							source: "user",
							message: "Hello, how are you?",
						},
						{
							step_id: 2,
							timestamp: "2025-01-15T10:00:01Z",
							source: "agent",
							model_name: "claude-sonnet-4-20250514",
							message: "I'm doing well, thank you!",
						},
					],
				},
				expected: [
					{
						role: "user",
						content: "Hello, how are you?",
						timestamp: "2025-01-15T10:00:00Z",
					},
					{
						role: "assistant",
						content: "I'm doing well, thank you!",
						timestamp: "2025-01-15T10:00:01Z",
						modelInfo: {
							modelId: "claude-sonnet-4-20250514",
							providerId: "unknown",
							reasoningEffort: undefined,
						},
					},
				],
			},
			{
				name: "Agent response with metrics",
				input: {
					schema_version: "ATIF-v1.3",
					session_id: "metrics-session",
					agent: {
						name: "cline",
						version: "1.0.0",
					},
					steps: [
						{
							step_id: 1,
							timestamp: "2025-01-15T10:00:00Z",
							source: "user",
							message: "What is 2+2?",
						},
						{
							step_id: 2,
							timestamp: "2025-01-15T10:00:01Z",
							source: "agent",
							model_name: "claude-sonnet-4-20250514",
							message: "2+2 equals 4",
							metrics: {
								prompt_tokens: 100,
								completion_tokens: 20,
								cached_tokens: 50,
								cost_usd: 0.001,
							},
						},
					],
				},
				expected: [
					{
						role: "user",
						content: "What is 2+2?",
						timestamp: "2025-01-15T10:00:00Z",
					},
					{
						role: "assistant",
						content: "2+2 equals 4",
						timestamp: "2025-01-15T10:00:01Z",
						modelInfo: {
							modelId: "claude-sonnet-4-20250514",
							providerId: "unknown",
							reasoningEffort: undefined,
						},
						metrics: {
							promptTokens: 100,
							completionTokens: 20,
							cachedTokens: 50,
							totalCost: 0.001,
						},
					},
				],
			},
			{
				name: "Agent with tool call",
				input: {
					schema_version: "ATIF-v1.3",
					session_id: "tool-session",
					agent: {
						name: "cline",
						version: "1.0.0",
					},
					steps: [
						{
							step_id: 1,
							timestamp: "2025-01-15T10:00:00Z",
							source: "user",
							message: "Read the config file",
						},
						{
							step_id: 2,
							timestamp: "2025-01-15T10:00:01Z",
							source: "agent",
							model_name: "claude-sonnet-4-20250514",
							message: "I'll read the config file for you",
							tool_calls: [
								{
									tool_call_id: "call_123",
									function_name: "Read",
									arguments: {
										file_path: "/config.json",
									},
								},
							],
						},
					],
				},
				expected: [
					{
						role: "user",
						content: "Read the config file",
						timestamp: "2025-01-15T10:00:00Z",
					},
					{
						role: "assistant",
						content: [
							{
								type: "text",
								text: "I'll read the config file for you",
							},
							{
								type: "tool_use",
								id: "call_123",
								name: "Read",
								input: {
									file_path: "/config.json",
								},
							},
						],
						timestamp: "2025-01-15T10:00:01Z",
						modelInfo: {
							modelId: "claude-sonnet-4-20250514",
							providerId: "unknown",
							reasoningEffort: undefined,
						},
					},
				],
			},
			{
				name: "Agent with reasoning content",
				input: {
					schema_version: "ATIF-v1.3",
					session_id: "reasoning-session",
					agent: {
						name: "cline",
						version: "1.0.0",
					},
					steps: [
						{
							step_id: 1,
							timestamp: "2025-01-15T10:00:00Z",
							source: "user",
							message: "Solve this problem",
						},
						{
							step_id: 2,
							timestamp: "2025-01-15T10:00:01Z",
							source: "agent",
							model_name: "claude-sonnet-4-20250514",
							reasoning_effort: "high",
							message: "Here's the solution",
							reasoning_content: "Let me think step by step: first, I need to...",
						},
					],
				},
				expected: [
					{
						role: "user",
						content: "Solve this problem",
						timestamp: "2025-01-15T10:00:00Z",
					},
					{
						role: "assistant",
						content: [
							{
								type: "thinking",
								thinking: "Let me think step by step: first, I need to...",
								signature: "2",
							},
							{
								type: "text",
								text: "Here's the solution",
							},
						],
						timestamp: "2025-01-15T10:00:01Z",
						modelInfo: {
							modelId: "claude-sonnet-4-20250514",
							providerId: "unknown",
							reasoningEffort: "high",
						},
					},
				],
			},
			{
				name: "User message with tool result",
				input: {
					schema_version: "ATIF-v1.3",
					session_id: "tool-result-session",
					agent: {
						name: "cline",
						version: "1.0.0",
					},
					steps: [
						{
							step_id: 1,
							timestamp: "2025-01-15T10:00:00Z",
							source: "agent",
							model_name: "claude-sonnet-4-20250514",
							message: "Reading file",
							tool_calls: [
								{
									tool_call_id: "call_456",
									function_name: "Read",
									arguments: {
										file_path: "/test.txt",
									},
								},
							],
						},
						{
							step_id: 2,
							timestamp: "2025-01-15T10:00:02Z",
							source: "user",
							message: "",
							observation: {
								results: [
									{
										source_call_id: "call_456",
										content: "File contents: Hello World",
									},
								],
							},
						},
					],
				},
				expected: [
					{
						role: "assistant",
						content: [
							{
								type: "text",
								text: "Reading file",
							},
							{
								type: "tool_use",
								id: "call_456",
								name: "Read",
								input: {
									file_path: "/test.txt",
								},
							},
						],
						timestamp: "2025-01-15T10:00:00Z",
						modelInfo: {
							modelId: "claude-sonnet-4-20250514",
							providerId: "unknown",
							reasoningEffort: undefined,
						},
					},
					{
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "call_456",
								content: "File contents: Hello World",
							},
						],
						timestamp: "2025-01-15T10:00:02Z",
					},
				],
			},
			{
				name: "Complete conversation with tool usage",
				input: {
					schema_version: "ATIF-v1.3",
					session_id: "complete-session",
					agent: {
						name: "cline",
						version: "1.0.0",
						model_name: "claude-sonnet-4-20250514",
					},
					steps: [
						{
							step_id: 1,
							timestamp: "2025-01-15T10:00:00Z",
							source: "user",
							message: "Fix the authentication bug",
						},
						{
							step_id: 2,
							timestamp: "2025-01-15T10:00:05Z",
							source: "agent",
							model_name: "claude-sonnet-4-20250514",
							message: "I'll investigate the issue",
							reasoning_content: "Need to examine the auth code first",
							tool_calls: [
								{
									tool_call_id: "call_read_1",
									function_name: "Read",
									arguments: {
										file_path: "/auth/login.ts",
									},
								},
							],
							metrics: {
								prompt_tokens: 1000,
								completion_tokens: 500,
								cached_tokens: 200,
								cost_usd: 0.05,
							},
						},
						{
							step_id: 3,
							timestamp: "2025-01-15T10:00:10Z",
							source: "user",
							message: "",
							observation: {
								results: [
									{
										source_call_id: "call_read_1",
										content: "export function login(username) { ... }",
									},
								],
							},
						},
						{
							step_id: 4,
							timestamp: "2025-01-15T10:00:15Z",
							source: "agent",
							model_name: "claude-sonnet-4-20250514",
							message: "Found the issue. The password validation is missing.",
							reasoning_content: undefined,
							tool_calls: [
								{
									tool_call_id: "call_edit_1",
									function_name: "Edit",
									arguments: {
										file_path: "/auth/login.ts",
										old_string: "if (username) {",
										new_string: "if (username && password) {",
									},
								},
							],
							metrics: {
								prompt_tokens: 1500,
								completion_tokens: 300,
								cached_tokens: 400,
								cost_usd: 0.03,
							},
						},
					],
					final_metrics: {
						total_prompt_tokens: 2500,
						total_completion_tokens: 800,
						total_cached_tokens: 600,
						total_cost_usd: 0.08,
						total_steps: 4,
					},
					notes: "Fixed authentication bug",
				},
				expected: [
					{
						role: "user",
						content: "Fix the authentication bug",
						timestamp: "2025-01-15T10:00:00Z",
					},
					{
						role: "assistant",
						content: [
							{
								type: "thinking",
								thinking: "Need to examine the auth code first",
								signature: "2",
							},
							{
								type: "text",
								text: "I'll investigate the issue",
							},
							{
								type: "tool_use",
								id: "call_read_1",
								name: "Read",
								input: {
									file_path: "/auth/login.ts",
								},
							},
						],
						timestamp: "2025-01-15T10:00:05Z",
						modelInfo: {
							modelId: "claude-sonnet-4-20250514",
							providerId: "unknown",
							reasoningEffort: undefined,
						},
						metrics: {
							promptTokens: 1000,
							completionTokens: 500,
							cachedTokens: 200,
							totalCost: 0.05,
						},
					},
					{
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "call_read_1",
								content: "export function login(username) { ... }",
							},
						],
						timestamp: "2025-01-15T10:00:10Z",
					},
					{
						role: "assistant",
						content: [
							{
								type: "text",
								text: "Found the issue. The password validation is missing.",
							},
							{
								type: "tool_use",
								id: "call_edit_1",
								name: "Edit",
								input: {
									file_path: "/auth/login.ts",
									old_string: "if (username) {",
									new_string: "if (username && password) {",
								},
							},
						],
						timestamp: "2025-01-15T10:00:15Z",
						modelInfo: {
							modelId: "claude-sonnet-4-20250514",
							providerId: "unknown",
							reasoningEffort: undefined,
						},
						metrics: {
							promptTokens: 1500,
							completionTokens: 300,
							cachedTokens: 400,
							totalCost: 0.03,
						},
					},
				],
			},
		]

		testCases.forEach((tc) => {
			it(tc.name, () => {
				const result = convertATIFToClineMessages(tc.input)
				expect(result).to.deep.equal(tc.expected)
			})
		})
	})

	describe("convertClineMessagesToATIF", () => {
		interface TestCase {
			name: string
			input: ClineStorageMessage[]
			options: {
				sessionId: string
				agentVersion: string
				defaultModelName?: string
				notes?: string
			}
			expected: ATIFTrajectory
		}

		const testCases: TestCase[] = [
			{
				name: "Simple user-agent conversation",
				input: [
					{
						role: "user",
						content: "Hello, how are you?",
						timestamp: "2025-01-15T10:00:00Z",
					},
					{
						role: "assistant",
						content: "I'm doing well, thank you!",
						timestamp: "2025-01-15T10:00:01Z",
						modelInfo: {
							modelId: "claude-sonnet-4-20250514",
							providerId: "anthropic",
						},
					},
				],
				options: {
					sessionId: "simple-session",
					agentVersion: "1.0.0",
				},
				expected: {
					schema_version: "ATIF-v1.3",
					session_id: "simple-session",
					agent: {
						name: "cline",
						version: "1.0.0",
						model_name: undefined,
						extra: {},
					},
					steps: [
						{
							step_id: 1,
							timestamp: "2025-01-15T10:00:00Z",
							source: "user",
							message: "Hello, how are you?",
						},
						{
							step_id: 2,
							timestamp: "2025-01-15T10:00:01Z",
							source: "agent",
							model_name: "claude-sonnet-4-20250514",
							message: "I'm doing well, thank you!",
						},
					],
					notes: undefined,
					final_metrics: {
						total_prompt_tokens: 0,
						total_completion_tokens: 0,
						total_cached_tokens: 0,
						total_cost_usd: 0,
						total_steps: 2,
						extra: {},
					},
					extra: {},
				},
			},
			{
				name: "Agent with metrics",
				input: [
					{
						role: "user",
						content: "What is 2+2?",
						timestamp: "2025-01-15T10:00:00Z",
					},
					{
						role: "assistant",
						content: "2+2 equals 4",
						timestamp: "2025-01-15T10:00:01Z",
						modelInfo: {
							modelId: "claude-sonnet-4-20250514",
							providerId: "anthropic",
						},
						metrics: {
							promptTokens: 100,
							completionTokens: 20,
							cachedTokens: 50,
							totalCost: 0.001,
						},
					},
				],
				options: {
					sessionId: "metrics-session",
					agentVersion: "1.0.0",
				},
				expected: {
					schema_version: "ATIF-v1.3",
					session_id: "metrics-session",
					agent: {
						name: "cline",
						version: "1.0.0",
						model_name: undefined,
						extra: {},
					},
					steps: [
						{
							step_id: 1,
							timestamp: "2025-01-15T10:00:00Z",
							source: "user",
							message: "What is 2+2?",
						},
						{
							step_id: 2,
							timestamp: "2025-01-15T10:00:01Z",
							source: "agent",
							model_name: "claude-sonnet-4-20250514",
							message: "2+2 equals 4",
							metrics: {
								prompt_tokens: 100,
								completion_tokens: 20,
								cached_tokens: 50,
								cost_usd: 0.001,
							},
						},
					],
					notes: undefined,
					final_metrics: {
						total_prompt_tokens: 100,
						total_completion_tokens: 20,
						total_cached_tokens: 50,
						total_cost_usd: 0.001,
						total_steps: 2,
						extra: {},
					},
					extra: {},
				},
			},
			{
				name: "Agent with tool call",
				input: [
					{
						role: "user",
						content: "Read the config file",
						timestamp: "2025-01-15T10:00:00Z",
					},
					{
						role: "assistant",
						content: [
							{
								type: "text",
								text: "I'll read the config file for you",
							},
							{
								type: "tool_use",
								id: "call_123",
								name: "Read",
								input: {
									file_path: "/config.json",
								},
							},
						],
						timestamp: "2025-01-15T10:00:01Z",
						modelInfo: {
							modelId: "claude-sonnet-4-20250514",
							providerId: "anthropic",
						},
					},
				],
				options: {
					sessionId: "tool-session",
					agentVersion: "1.0.0",
				},
				expected: {
					schema_version: "ATIF-v1.3",
					session_id: "tool-session",
					agent: {
						name: "cline",
						version: "1.0.0",
						model_name: undefined,
						extra: {},
					},
					steps: [
						{
							step_id: 1,
							timestamp: "2025-01-15T10:00:00Z",
							source: "user",
							message: "Read the config file",
						},
						{
							step_id: 2,
							timestamp: "2025-01-15T10:00:01Z",
							source: "agent",
							model_name: "claude-sonnet-4-20250514",
							message: "I'll read the config file for you",
							reasoning_content: undefined,
							tool_calls: [
								{
									tool_call_id: "call_123",
									function_name: "Read",
									arguments: {
										file_path: "/config.json",
									},
								},
							],
						},
					],
					notes: undefined,
					final_metrics: {
						total_prompt_tokens: 0,
						total_completion_tokens: 0,
						total_cached_tokens: 0,
						total_cost_usd: 0,
						total_steps: 2,
						extra: {},
					},
					extra: {},
				},
			},
			{
				name: "Agent with reasoning content",
				input: [
					{
						role: "user",
						content: "Solve this problem",
						timestamp: "2025-01-15T10:00:00Z",
					},
					{
						role: "assistant",
						content: [
							{
								type: "thinking",
								thinking: "Let me think step by step: first, I need to...",
								signature: "2",
							},
							{
								type: "text",
								text: "Here's the solution",
							},
						],
						timestamp: "2025-01-15T10:00:01Z",
						modelInfo: {
							modelId: "claude-sonnet-4-20250514",
							providerId: "anthropic",
							reasoningEffort: "high",
						},
					},
				],
				options: {
					sessionId: "reasoning-session",
					agentVersion: "1.0.0",
				},
				expected: {
					schema_version: "ATIF-v1.3",
					session_id: "reasoning-session",
					agent: {
						name: "cline",
						version: "1.0.0",
						model_name: undefined,
						extra: {},
					},
					steps: [
						{
							step_id: 1,
							timestamp: "2025-01-15T10:00:00Z",
							source: "user",
							message: "Solve this problem",
						},
						{
							step_id: 2,
							timestamp: "2025-01-15T10:00:01Z",
							source: "agent",
							model_name: "claude-sonnet-4-20250514",
							reasoning_effort: "high",
							message: "Here's the solution",
							reasoning_content: "Let me think step by step: first, I need to...",
						},
					],
					notes: undefined,
					final_metrics: {
						total_prompt_tokens: 0,
						total_completion_tokens: 0,
						total_cached_tokens: 0,
						total_cost_usd: 0,
						total_steps: 2,
						extra: {},
					},
					extra: {},
				},
			},
			{
				name: "Complete conversation with tool usage",
				input: [
					{
						role: "user",
						content: "Fix the authentication bug",
						timestamp: "2025-01-15T10:00:00Z",
					},
					{
						role: "assistant",
						content: [
							{
								type: "thinking",
								thinking: "Need to examine the auth code first",
								signature: "2",
							},
							{
								type: "text",
								text: "I'll investigate the issue",
							},
							{
								type: "tool_use",
								id: "call_read_1",
								name: "Read",
								input: {
									file_path: "/auth/login.ts",
								},
							},
						],
						timestamp: "2025-01-15T10:00:05Z",
						modelInfo: {
							modelId: "claude-sonnet-4-20250514",
							providerId: "anthropic",
						},
						metrics: {
							promptTokens: 1000,
							completionTokens: 500,
							cachedTokens: 200,
							totalCost: 0.05,
						},
					},
					{
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "call_read_1",
								content: "export function login(username) { ... }",
							},
						],
						timestamp: "2025-01-15T10:00:10Z",
					},
					{
						role: "assistant",
						content: [
							{
								type: "text",
								text: "Found the issue. The password validation is missing.",
							},
							{
								type: "tool_use",
								id: "call_edit_1",
								name: "Edit",
								input: {
									file_path: "/auth/login.ts",
									old_string: "if (username) {",
									new_string: "if (username && password) {",
								},
							},
						],
						timestamp: "2025-01-15T10:00:15Z",
						modelInfo: {
							modelId: "claude-sonnet-4-20250514",
							providerId: "anthropic",
						},
						metrics: {
							promptTokens: 1500,
							completionTokens: 300,
							cachedTokens: 400,
							totalCost: 0.03,
						},
					},
				],
				options: {
					sessionId: "complete-session",
					agentVersion: "1.0.0",
					notes: "Fixed authentication bug",
				},
				expected: {
					schema_version: "ATIF-v1.3",
					session_id: "complete-session",
					agent: {
						name: "cline",
						version: "1.0.0",
						model_name: undefined,
						extra: {},
					},
					steps: [
						{
							step_id: 1,
							timestamp: "2025-01-15T10:00:00Z",
							source: "user",
							message: "Fix the authentication bug",
						},
						{
							step_id: 2,
							timestamp: "2025-01-15T10:00:05Z",
							source: "agent",
							model_name: "claude-sonnet-4-20250514",
							message: "I'll investigate the issue",
							reasoning_content: "Need to examine the auth code first",
							tool_calls: [
								{
									tool_call_id: "call_read_1",
									function_name: "Read",
									arguments: {
										file_path: "/auth/login.ts",
									},
								},
							],
							metrics: {
								prompt_tokens: 1000,
								completion_tokens: 500,
								cached_tokens: 200,
								cost_usd: 0.05,
							},
						},
						{
							step_id: 3,
							timestamp: "2025-01-15T10:00:10Z",
							source: "user",
							message: "",
						},
						{
							step_id: 4,
							timestamp: "2025-01-15T10:00:15Z",
							source: "agent",
							model_name: "claude-sonnet-4-20250514",
							message: "Found the issue. The password validation is missing.",
							reasoning_content: undefined,
							tool_calls: [
								{
									tool_call_id: "call_edit_1",
									function_name: "Edit",
									arguments: {
										file_path: "/auth/login.ts",
										old_string: "if (username) {",
										new_string: "if (username && password) {",
									},
								},
							],
							metrics: {
								prompt_tokens: 1500,
								completion_tokens: 300,
								cached_tokens: 400,
								cost_usd: 0.03,
							},
						},
					],
					notes: "Fixed authentication bug",
					final_metrics: {
						total_prompt_tokens: 2500,
						total_completion_tokens: 800,
						total_cached_tokens: 600,
						total_cost_usd: 0.08,
						total_steps: 4,
						extra: {},
					},
					extra: {},
				},
			},
		]

		testCases.forEach((tc) => {
			it(tc.name, () => {
				const result = convertClineMessagesToATIF(tc.input, tc.options)
				expect(result).to.deep.equal(tc.expected)
			})
		})
	})

	describe("enrichMessagesWithMetrics", () => {
		interface TestCase {
			name: string
			apiConversationHistory: ClineStorageMessage[]
			clineMessages: ClineMessage[]
			expected: ClineStorageMessage[]
		}

		const testCases: TestCase[] = [
			{
				name: "Single assistant message with metrics",
				apiConversationHistory: [
					{
						role: "user",
						content: "What is 2+2?",
					},
					{
						role: "assistant",
						content: "2+2 equals 4",
					},
				],
				clineMessages: [
					{
						ts: 1000,
						type: "say",
						say: "api_req_started",
						text: JSON.stringify({
							tokensIn: 100,
							tokensOut: 20,
							cacheWrites: 10,
							cacheReads: 5,
							cost: 0.001,
						}),
					},
				],
				expected: [
					{
						role: "user",
						content: "What is 2+2?",
					},
					{
						role: "assistant",
						content: "2+2 equals 4",
						metrics: {
							promptTokens: 100,
							completionTokens: 20,
							cachedTokens: 15, // 10 + 5
							totalCost: 0.001,
						},
					},
				],
			},
			{
				name: "Multiple assistant messages with separate metrics",
				apiConversationHistory: [
					{
						role: "user",
						content: "First question",
					},
					{
						role: "assistant",
						content: "First answer",
					},
					{
						role: "user",
						content: "Second question",
					},
					{
						role: "assistant",
						content: "Second answer",
					},
				],
				clineMessages: [
					{
						ts: 1000,
						type: "say",
						say: "api_req_started",
						text: JSON.stringify({
							tokensIn: 100,
							tokensOut: 20,
							cost: 0.001,
						}),
					},
					{
						ts: 2000,
						type: "say",
						say: "api_req_started",
						text: JSON.stringify({
							tokensIn: 150,
							tokensOut: 30,
							cost: 0.002,
						}),
					},
				],
				expected: [
					{
						role: "user",
						content: "First question",
					},
					{
						role: "assistant",
						content: "First answer",
						metrics: {
							promptTokens: 100,
							completionTokens: 20,
							cachedTokens: 0,
							totalCost: 0.001,
						},
					},
					{
						role: "user",
						content: "Second question",
					},
					{
						role: "assistant",
						content: "Second answer",
						metrics: {
							promptTokens: 150,
							completionTokens: 30,
							cachedTokens: 0,
							totalCost: 0.002,
						},
					},
				],
			},
			{
				name: "Missing cache metrics defaults to 0",
				apiConversationHistory: [
					{
						role: "user",
						content: "Question",
					},
					{
						role: "assistant",
						content: "Answer",
					},
				],
				clineMessages: [
					{
						ts: 1000,
						type: "say",
						say: "api_req_started",
						text: JSON.stringify({
							tokensIn: 100,
							tokensOut: 20,
							cost: 0.001,
							// No cacheWrites or cacheReads
						}),
					},
				],
				expected: [
					{
						role: "user",
						content: "Question",
					},
					{
						role: "assistant",
						content: "Answer",
						metrics: {
							promptTokens: 100,
							completionTokens: 20,
							cachedTokens: 0,
							totalCost: 0.001,
						},
					},
				],
			},
			{
				name: "Malformed JSON skips metrics",
				apiConversationHistory: [
					{
						role: "user",
						content: "Question",
					},
					{
						role: "assistant",
						content: "Answer",
					},
				],
				clineMessages: [
					{
						ts: 1000,
						type: "say",
						say: "api_req_started",
						text: "not valid json {",
					},
				],
				expected: [
					{
						role: "user",
						content: "Question",
					},
					{
						role: "assistant",
						content: "Answer",
						// No metrics added
					},
				],
			},
			{
				name: "Missing required fields skips metrics",
				apiConversationHistory: [
					{
						role: "assistant",
						content: "Answer",
					},
				],
				clineMessages: [
					{
						ts: 1000,
						type: "say",
						say: "api_req_started",
						text: JSON.stringify({
							// Missing tokensIn and tokensOut
							cost: 0.001,
						}),
					},
				],
				expected: [
					{
						role: "assistant",
						content: "Answer",
						// No metrics added
					},
				],
			},
			{
				name: "More assistant messages than api_req_started",
				apiConversationHistory: [
					{
						role: "assistant",
						content: "First response",
					},
					{
						role: "assistant",
						content: "Second response",
					},
				],
				clineMessages: [
					{
						ts: 1000,
						type: "say",
						say: "api_req_started",
						text: JSON.stringify({
							tokensIn: 100,
							tokensOut: 20,
							cost: 0.001,
						}),
					},
				],
				expected: [
					{
						role: "assistant",
						content: "First response",
						metrics: {
							promptTokens: 100,
							completionTokens: 20,
							cachedTokens: 0,
							totalCost: 0.001,
						},
					},
					{
						role: "assistant",
						content: "Second response",
						// No metrics for second message
					},
				],
			},
			{
				name: "Empty arrays returns empty array",
				apiConversationHistory: [],
				clineMessages: [],
				expected: [],
			},
		]

		testCases.forEach((tc) => {
			it(tc.name, () => {
				const result = enrichMessagesWithMetrics(tc.apiConversationHistory, tc.clineMessages)
				expect(result).to.deep.equal(tc.expected)
			})
		})

		it("should not modify original arrays", () => {
			const clineMessages: ClineMessage[] = [
				{
					ts: 1000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({
						tokensIn: 100,
						tokensOut: 200,
						cost: 0.05,
					}),
				},
			]

			const apiConversationHistory: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: "Response",
				},
			]

			const originalHistoryCopy = JSON.parse(JSON.stringify(apiConversationHistory))
			const originalClineMessagesCopy = JSON.parse(JSON.stringify(clineMessages))

			enrichMessagesWithMetrics(apiConversationHistory, clineMessages)

			// Original arrays should not be modified
			expect(apiConversationHistory).to.deep.equal(originalHistoryCopy)
			expect(clineMessages).to.deep.equal(originalClineMessagesCopy)
		})
	})

	describe("ATIF Snapshot Tests", () => {
		// Check if snapshots should be updated via process argument
		const UPDATE_SNAPSHOTS = process.argv.includes("--update-snapshots") || process.env.UPDATE_SNAPSHOTS === "true"
		const SNAPSHOT_DIR = __dirname + "/__snapshots__"

		const compareWithSnapshot = async (snapshotName: string, actual: string): Promise<void> => {
			const snapshotPath = `${SNAPSHOT_DIR}/${snapshotName}.json`

			if (UPDATE_SNAPSHOTS) {
				// Ensure snapshot directory exists
				const fs = await import("node:fs/promises")
				await fs.mkdir(SNAPSHOT_DIR, { recursive: true })
				// Write new snapshot
				await fs.writeFile(snapshotPath, actual, "utf-8")
				return
			}

			// Read and compare with existing snapshot
			const fs = await import("node:fs/promises")
			try {
				const expected = await fs.readFile(snapshotPath, "utf-8")
				expect(actual).to.equal(
					expected,
					`Snapshot mismatch for ${snapshotName}. Run with UPDATE_SNAPSHOTS=true to update.`,
				)
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					throw new Error(`Snapshot file not found: ${snapshotPath}. Run with UPDATE_SNAPSHOTS=true to create it.`)
				}
				throw error
			}
		}

		it("should match snapshot for complete conversation with tools and reasoning", async () => {
			const input: ClineStorageMessage[] = [
				{
					role: "user",
					content: "Fix the authentication bug",
					timestamp: "2025-01-15T10:00:00Z",
				},
				{
					role: "assistant",
					content: [
						{
							type: "thinking",
							thinking: "Need to examine the auth code first",
							signature: "2",
						},
						{
							type: "text",
							text: "I'll investigate the issue",
						},
						{
							type: "tool_use",
							id: "call_read_1",
							name: "Read",
							input: {
								file_path: "/auth/login.ts",
							},
						},
					],
					timestamp: "2025-01-15T10:00:05Z",
					modelInfo: {
						modelId: "claude-sonnet-4-20250514",
						providerId: "anthropic",
					},
					metrics: {
						promptTokens: 1000,
						completionTokens: 500,
						cachedTokens: 200,
						totalCost: 0.05,
					},
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_read_1",
							content: "export function login(username) { ... }",
						},
					],
					timestamp: "2025-01-15T10:00:10Z",
				},
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Found the issue. The password validation is missing.",
						},
						{
							type: "tool_use",
							id: "call_edit_1",
							name: "Edit",
							input: {
								file_path: "/auth/login.ts",
								old_string: "if (username) {",
								new_string: "if (username && password) {",
							},
						},
					],
					timestamp: "2025-01-15T10:00:15Z",
					modelInfo: {
						modelId: "claude-sonnet-4-20250514",
						providerId: "anthropic",
					},
					metrics: {
						promptTokens: 1500,
						completionTokens: 300,
						cachedTokens: 400,
						totalCost: 0.03,
					},
				},
			]

			const options = {
				sessionId: "snapshot-test-session",
				agentVersion: "1.0.0",
				notes: "Fixed authentication bug",
			}

			const result = convertClineMessagesToATIF(input, options)
			const serialized = JSON.stringify(result, null, 2)

			await compareWithSnapshot("atif-complete-conversation", serialized)
		})

		it("should match snapshot for ATIF to ClineStorageMessage conversion", async () => {
			// This is the ATIF format that needs to be converted to ClineStorageMessage format
			// Copied from https://github.com/laude-institute/harbor/blob/main/docs/rfcs/0001-trajectory-format.md#iv-example-atif-trajectory-log-multi-step-task
			const atifInput: ATIFTrajectory = {
				schema_version: "ATIF-v1.3",
				session_id: "025B810F-B3A2-4C67-93C0-FE7A142A947A",
				agent: {
					name: "harbor-agent",
					version: "1.0.0",
					model_name: "gemini-2.5-flash",
					extra: {},
				},
				notes: "Initial test trajectory for financial data retrieval using a single-hop ReAct pattern, focusing on multi-tool execution in Step 2.",
				extra: {},
				final_metrics: {
					total_prompt_tokens: 1120,
					total_completion_tokens: 124,
					total_cached_tokens: 200,
					total_cost_usd: 0.00078,
					total_steps: 3,
					extra: {},
				},
				steps: [
					{
						step_id: 1,
						timestamp: "2025-10-11T10:30:00Z",
						source: "user",
						message: "What is the current trading price of Alphabet (GOOGL)?",
						extra: {},
					},
					{
						step_id: 2,
						timestamp: "2025-10-11T10:30:02Z",
						source: "agent",
						model_name: "gemini-2.5-flash",
						reasoning_effort: "medium",
						message: "I will search for the current trading price and volume for GOOGL.",
						reasoning_content:
							"The request requires two data points: the current stock price and the latest volume data. I will execute two simultaneous tool calls—one for price and one for volume—to retrieve this information in a single step.",
						tool_calls: [
							{
								tool_call_id: "call_price_1",
								function_name: "financial_search",
								arguments: { ticker: "GOOGL", metric: "price" },
							},
							{
								tool_call_id: "call_volume_2",
								function_name: "financial_search",
								arguments: { ticker: "GOOGL", metric: "volume" },
							},
						],
						observation: {
							results: [
								{
									source_call_id: "call_price_1",
									content: "GOOGL is currently trading at $185.35 (Close: 10/11/2025)",
								},
								{
									source_call_id: "call_volume_2",
									content: "GOOGL volume: 1.5M shares traded.",
								},
							],
						},
						metrics: {
							prompt_tokens: 520,
							completion_tokens: 80,
							cached_tokens: 200,
							cost_usd: 0.00045,
						},
					},
					{
						step_id: 3,
						timestamp: "2025-10-11T10:30:05Z",
						source: "agent",
						model_name: "gemini-2.5-flash",
						reasoning_effort: "low",
						message:
							"As of October 11, 2025, Alphabet (GOOGL) is trading at $185.35 with a volume of 1.5M shares traded.",
						reasoning_content:
							"The previous step retrieved all necessary data. I will now format this into a final conversational response for the user and terminate the task.",
						metrics: {
							prompt_tokens: 600,
							completion_tokens: 44,
							completion_token_ids: [
								1722, 310, 5533, 1722, 13, 1640, 13, 1423, 13, 8425, 338, 313, 18672, 29, 338, 11302, 472, 395,
								29896, 29945, 29945, 29889, 29941, 29945, 411, 263, 7977, 310, 29871, 29896, 29889, 29945, 29924,
								29358, 3534, 287, 29889,
							],
							logprobs: [
								-0.1, -0.05, -0.02, -0.01, -0.2, -0.15, -0.08, -0.03, -0.12, -0.06, -0.04, -0.11, -0.07, -0.09,
								-0.13, -0.05, -0.02, -0.08, -0.14, -0.06, -0.03, -0.1, -0.04, -0.07, -0.05, -0.09, -0.03, -0.11,
								-0.08, -0.06, -0.12, -0.04, -0.07, -0.05, -0.1, -0.03, -0.08, -0.06, -0.11, -0.04, -0.07, -0.05,
								-0.09, -0.02,
							],
							cost_usd: 0.00033,
							extra: {
								reasoning_tokens: 12,
							},
						},
					},
				],
			}

			const result = convertATIFToClineMessages(atifInput)
			const serialized = JSON.stringify(result, null, 2)

			await compareWithSnapshot("cline-storage-from-atif", serialized)
		})
	})
})
