/**
 * Example: Building Agentic Loops with Sub-Agent Spawning
 *
 * This example demonstrates how to use the @clinebot/agents, @clinebot/llms,
 * and @clinebot/llms packages together to build an agentic loop where the
 * main agent can spawn sub-agents to handle specialized tasks.
 *
 * Features demonstrated:
 * - Creating an Agent with a user-provided system prompt
 * - Defining custom tools
 * - Spawning sub-agents via tool calls (LLM can create new agents)
 * - Handling agent events for streaming output
 * - Using the models package to query available models
 */

import * as providers from "@clinebot/llms/providers";
import { Agent, type AgentEvent, createTool, type Tool } from "./index.js";

// Note: When workspace is linked, you can also import from @clinebot/llms/models:
// import { getModel, queryModels } from "@clinebot/llms/models"

// =============================================================================
// Configuration
// =============================================================================

interface AgentSpawnerConfig {
	/** Provider ID (e.g., "anthropic", "openai", "gemini") */
	providerId: string;
	/** Model ID to use */
	modelId: string;
	/** API key for the provider */
	apiKey: string;
	/** Optional base URL for the API */
	baseUrl?: string;
	/** Maximum iterations for spawned sub-agents */
	subAgentMaxIterations?: number;
}

// =============================================================================
// Sub-Agent Tool
// =============================================================================

interface SpawnAgentInput {
	systemPrompt: string;
	task: string;
	maxIterations?: number;
}

interface SpawnAgentOutput {
	text: string;
	iterations: number;
	finishReason: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
	};
}

/**
 * Creates a tool that allows the LLM to spawn new agents with custom system prompts.
 *
 * This enables patterns like:
 * - Task delegation: Main agent spawns specialists for specific tasks
 * - Parallel execution: Multiple sub-agents working on different aspects
 * - Chain-of-thought delegation: Breaking complex problems into sub-problems
 */
function createSpawnAgentTool(
	config: AgentSpawnerConfig,
): Tool<SpawnAgentInput, SpawnAgentOutput> {
	return createTool<SpawnAgentInput, SpawnAgentOutput>({
		name: "spawn_agent",
		description: `Spawn a new AI agent with a custom system prompt to handle a specific task.
The spawned agent will run independently and return its final result.
Use this when you need to delegate a specialized task that benefits from a focused system prompt.

Examples of when to use:
- Complex code analysis that needs a specialized reviewer persona
- Creative writing that benefits from a specific author's style
- Technical explanations that need domain expertise
- Multi-step tasks that benefit from focused attention`,
		inputSchema: {
			type: "object",
			properties: {
				systemPrompt: {
					type: "string",
					description:
						"The system prompt for the spawned agent. This defines the agent's persona, capabilities, and behavior.",
				},
				task: {
					type: "string",
					description:
						"The specific task or question for the spawned agent to handle.",
				},
				maxIterations: {
					type: "integer",
					description:
						"Maximum number of iterations for the sub-agent (default: 10)",
					minimum: 1,
					maximum: 50,
				},
			},
			required: ["systemPrompt", "task"],
		},
		execute: async (input, context) => {
			const { systemPrompt, task, maxIterations } = input;

			// Create the sub-agent with the provided system prompt
			const subAgent = new Agent({
				providerId: config.providerId,
				modelId: config.modelId,
				apiKey: config.apiKey,
				baseUrl: config.baseUrl,
				systemPrompt,
				tools: [], // Sub-agents don't get the spawn tool to prevent infinite recursion
				maxIterations: maxIterations ?? config.subAgentMaxIterations ?? 10,
				abortSignal: context.abortSignal,
				onEvent: (event) => {
					// Log sub-agent events with prefix for debugging
					if (event.type === "content_start" && event.contentType === "text") {
						console.log(`[SubAgent] ${event.text ?? ""}`);
					}
				},
			});

			// Run the sub-agent
			const result = await subAgent.run(task);

			return {
				text: result.text,
				iterations: result.iterations,
				finishReason: result.finishReason,
				usage: {
					inputTokens: result.usage.inputTokens,
					outputTokens: result.usage.outputTokens,
				},
			};
		},
		timeoutMs: 300000, // 5 minutes for sub-agent execution
		retryable: false, // Don't retry sub-agent spawns
	});
}

// =============================================================================
// Additional Example Tools
// =============================================================================

interface CalculateInput {
	expression: string;
}

/**
 * A simple calculation tool for demonstration
 */
const calculatorTool = createTool<
	CalculateInput,
	{ result: number; expression: string }
>({
	name: "calculate",
	description:
		"Perform basic mathematical calculations. Supports +, -, *, /, and ** (power).",
	inputSchema: {
		type: "object",
		properties: {
			expression: {
				type: "string",
				description:
					"The mathematical expression to evaluate (e.g., '2 + 2', '10 * 5', '2 ** 8')",
			},
		},
		required: ["expression"],
	},
	execute: async ({ expression }) => {
		// Basic sanitization - only allow numbers and operators
		const sanitized = expression.replace(/[^0-9+\-*/.()\s^]/g, "");
		// Replace ^ with ** for power operations
		const jsExpression = sanitized.replace(/\^/g, "**");

		// Simple and safe math evaluation using basic parsing
		const result = evaluateMathExpression(jsExpression);
		return { result, expression: jsExpression };
	},
});

/**
 * Simple math expression evaluator (safer than eval/Function)
 */
function evaluateMathExpression(expr: string): number {
	// Remove whitespace
	const cleaned = expr.replace(/\s/g, "");

	// Basic recursive descent parser for safety
	let pos = 0;

	function parseNumber(): number {
		let numStr = "";
		while (pos < cleaned.length) {
			const char = cleaned[pos];
			if (char === undefined || !/[0-9.]/.test(char)) {
				break;
			}
			numStr += char;
			pos++;
		}
		return Number.parseFloat(numStr);
	}

	function parseFactor(): number {
		if (cleaned[pos] === "(") {
			pos++; // skip '('
			const result = parseExpression();
			pos++; // skip ')'
			return result;
		}
		if (cleaned[pos] === "-") {
			pos++;
			return -parseFactor();
		}
		return parseNumber();
	}

	function parsePower(): number {
		let left = parseFactor();
		while (pos < cleaned.length && cleaned.slice(pos, pos + 2) === "**") {
			pos += 2;
			left = left ** parseFactor();
		}
		return left;
	}

	function parseTerm(): number {
		let left = parsePower();
		while (
			pos < cleaned.length &&
			(cleaned[pos] === "*" || cleaned[pos] === "/")
		) {
			const op = cleaned[pos++];
			const right = parsePower();
			left = op === "*" ? left * right : left / right;
		}
		return left;
	}

	function parseExpression(): number {
		let left = parseTerm();
		while (
			pos < cleaned.length &&
			(cleaned[pos] === "+" || cleaned[pos] === "-")
		) {
			const op = cleaned[pos++];
			const right = parseTerm();
			left = op === "+" ? left + right : left - right;
		}
		return left;
	}

	return parseExpression();
}

interface DateTimeInput {
	format: "iso" | "unix" | "readable" | "components";
	timezone?: string;
}

type DateTimeOutput =
	| { datetime: string; timezone: string }
	| { timestamp: number; milliseconds: number }
	| {
			year: number;
			month: number;
			day: number;
			hour: number;
			minute: number;
			second: number;
			dayOfWeek: string;
	  };

/**
 * A tool to get current date/time
 */
const dateTimeTool = createTool<DateTimeInput, DateTimeOutput>({
	name: "get_datetime",
	description: "Get the current date and time in various formats",
	inputSchema: {
		type: "object",
		properties: {
			format: {
				type: "string",
				description:
					"Output format: 'iso', 'unix', 'readable', or 'components'",
				enum: ["iso", "unix", "readable", "components"],
			},
			timezone: {
				type: "string",
				description:
					"Timezone (e.g., 'UTC', 'America/New_York'). Defaults to local timezone.",
			},
		},
		required: ["format"],
	},
	execute: async ({ format, timezone }) => {
		const now = new Date();

		switch (format) {
			case "iso":
				return { datetime: now.toISOString(), timezone: timezone ?? "UTC" };
			case "unix":
				return {
					timestamp: Math.floor(now.getTime() / 1000),
					milliseconds: now.getTime(),
				};
			case "readable":
				return {
					datetime: now.toLocaleString("en-US", {
						timeZone: timezone ?? undefined,
						dateStyle: "full",
						timeStyle: "long",
					}),
					timezone: timezone ?? "local",
				};
			case "components":
				return {
					year: now.getFullYear(),
					month: now.getMonth() + 1,
					day: now.getDate(),
					hour: now.getHours(),
					minute: now.getMinutes(),
					second: now.getSeconds(),
					dayOfWeek: now.toLocaleDateString("en-US", { weekday: "long" }),
				};
			default:
				return { datetime: now.toISOString(), timezone: "UTC" };
		}
	},
});

// =============================================================================
// Event Handler
// =============================================================================

/**
 * Handle agent events for logging/debugging
 */
function handleAgentEvent(event: AgentEvent): void {
	switch (event.type) {
		case "iteration_start":
			console.log(`\n--- Iteration ${event.iteration} ---`);
			break;
		case "content_start":
			if (event.contentType === "text") {
				process.stdout.write(event.text ?? "");
			} else if (event.contentType === "reasoning") {
				if (!event.redacted) {
					console.log(`[Thinking] ${event.reasoning ?? ""}`);
				}
			} else if (event.contentType === "tool") {
				console.log(`\n[Tool] Calling ${event.toolName}...`);
			}
			break;
		case "content_end":
			if (event.contentType === "tool") {
				if (event.error) {
					console.log(`[Tool] ${event.toolName} failed: ${event.error}`);
				} else {
					console.log(
						`[Tool] ${event.toolName} completed in ${event.durationMs}ms`,
					);
				}
			}
			break;
		case "usage":
			console.log(
				`[Usage] In: ${event.totalInputTokens}, Out: ${event.totalOutputTokens}`,
			);
			break;
		case "done":
			console.log(
				`\n--- Done (${event.reason}) after ${event.iterations} iterations ---`,
			);
			break;
		case "error":
			console.error(`[Error] ${event.error.message}`);
			break;
	}
}

// =============================================================================
// Main Agent Factory
// =============================================================================

/**
 * Creates a main orchestrator agent that can spawn sub-agents.
 *
 * @param systemPrompt - The system prompt defining the main agent's behavior
 * @param config - Configuration for the agent and sub-agent spawning
 * @param additionalTools - Additional tools to provide to the main agent
 */
export function createOrchestratorAgent(
	systemPrompt: string,
	config: AgentSpawnerConfig,
	additionalTools: Tool[] = [],
): Agent {
	// Create the spawn agent tool
	const spawnTool = createSpawnAgentTool(config);

	// Combine all tools (cast to Tool[] since generics are contravariant in input)
	const tools = [
		spawnTool,
		calculatorTool,
		dateTimeTool,
		...additionalTools,
	] as Tool[];

	// Create and return the agent
	return new Agent({
		providerId: config.providerId,
		modelId: config.modelId,
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		systemPrompt,
		tools,
		maxIterations: 50,
		onEvent: handleAgentEvent,
	});
}

// =============================================================================
// Example Usage
// =============================================================================

/**
 * Example: Run the orchestrator agent with a task
 */
async function runExample(): Promise<void> {
	// Check for API key
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		console.error("Please set ANTHROPIC_API_KEY environment variable");
		process.exit(1);
	}

	// Model to use
	const modelId = "claude-sonnet-4-20250514";
	console.log(`Using model: ${modelId}`);
	console.log();

	// Create the orchestrator agent
	const orchestrator = createOrchestratorAgent(
		`You are an intelligent orchestrator that can delegate tasks to specialized sub-agents.

When faced with complex tasks, consider:
1. Breaking them into smaller, focused sub-tasks
2. Spawning specialized agents with appropriate system prompts
3. Synthesizing results from multiple agents

You have access to:
- spawn_agent: Create a new agent with a custom system prompt
- calculate: Perform mathematical calculations
- get_datetime: Get current date/time

Be strategic about when to spawn agents vs. handling tasks directly.`,
		{
			providerId: "anthropic",
			modelId: "claude-sonnet-4-20250514",
			apiKey,
			subAgentMaxIterations: 5,
		},
	);

	// Example task that might benefit from sub-agent delegation
	const task = `I need help with two things:
1. Calculate the compound interest on $10,000 at 5% annual rate for 10 years
2. Write a haiku about programming

For the haiku, please spawn a specialized creative writing agent to handle it.`;

	console.log("=".repeat(60));
	console.log("Task:", task);
	console.log("=".repeat(60));

	// Run the agent
	const result = await orchestrator.run(task);

	// Print summary
	console.log(`\n${"=".repeat(60)}`);
	console.log("Final Result:");
	console.log("=".repeat(60));
	console.log(result.text);
	console.log("\nStats:");
	console.log(`  - Iterations: ${result.iterations}`);
	console.log(
		`  - Total tokens: ${result.usage.inputTokens + result.usage.outputTokens}`,
	);
	console.log(`  - Tool calls: ${result.toolCalls.length}`);
	console.log(`  - Duration: ${result.durationMs}ms`);
}

// =============================================================================
// Alternative: Lower-level Provider Usage
// =============================================================================

/**
 * Example of using @clinebot/llms directly for more control
 */
async function runLowLevelExample(): Promise<void> {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		console.error("Please set ANTHROPIC_API_KEY environment variable");
		process.exit(1);
	}

	// Create a handler directly using @clinebot/llms
	const config: providers.ProviderConfig = {
		providerId: "anthropic",
		apiKey,
		modelId: "claude-sonnet-4-20250514",
	};

	const handler = providers.createHandler(config);

	// Use the handler to create a message stream
	const stream = handler.createMessage(
		"You are a helpful assistant.",
		[{ role: "user", content: "Say hello in 3 languages." }],
		[], // No tools for this simple example
	);

	// Process the stream
	console.log("Response: ");
	for await (const chunk of stream) {
		if (chunk.type === "text") {
			process.stdout.write(chunk.text);
		}
	}
	console.log();
}

// =============================================================================
// Exports for Library Usage
// =============================================================================

export {
	createSpawnAgentTool,
	calculatorTool,
	dateTimeTool,
	handleAgentEvent,
	type AgentSpawnerConfig,
	type SpawnAgentInput,
	type SpawnAgentOutput,
};

// =============================================================================
// CLI Entry Point
// =============================================================================

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	const mode = process.argv[2] ?? "orchestrator";

	if (mode === "low-level") {
		runLowLevelExample().catch(console.error);
	} else {
		runExample().catch(console.error);
	}
}
