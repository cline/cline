/**
 * Example 14: Agentic Loops with Sub-Agent Spawning
 *
 * A main orchestrator agent breaks a task into pieces and delegates
 * to specialized sub-agents. Shows:
 *   - Custom tools (calculator, datetime)
 *   - Spawning child agents with focused system prompts
 *   - Streaming events
 *
 * Unlike the earlier examples, this one drops to the lower-level
 * @clinebot/agents API and pulls in spawn-agent plumbing from @clinebot/core.
 */

import { Agent, type AgentEvent } from "@clinebot/agents";
import { createSpawnAgentTool } from "@clinebot/core";

const API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MODEL = "claude-sonnet-4-20250514";
const PROVIDER = "anthropic";

// =============================================================================
// Tools
// =============================================================================

const calculatorTool = {
	name: "calculate",
	description: "Evaluate a math expression like '2 + 2' or '10 * (3 ** 2)'",
	inputSchema: {
		type: "object",
		properties: { expression: { type: "string" } },
		required: ["expression"],
	},
	execute: async (input: unknown) => {
		const { expression } = input as { expression: string };
		// Safe recursive-descent parser — no eval
		const src = expression.replace(/\s/g, "").replace(/\^/g, "**");
		let i = 0;

		const num = (): number => {
			let s = "";
			while (i < src.length && /[0-9.]/.test(src[i] ?? "")) s += src[i++] ?? "";
			return parseFloat(s);
		};
		const factor = (): number => {
			if (src[i] === "(") {
				i++;
				const v = expr();
				i++;
				return v;
			}
			if (src[i] === "-") {
				i++;
				return -factor();
			}
			return num();
		};
		const power = (): number => {
			let v = factor();
			while (src.slice(i, i + 2) === "**") {
				i += 2;
				v **= factor();
			}
			return v;
		};
		const term = (): number => {
			let v = power();
			while (src[i] === "*" || src[i] === "/") {
				const op = src[i++] ?? "*";
				v = op === "*" ? v * power() : v / power();
			}
			return v;
		};
		const expr = (): number => {
			let v = term();
			while (src[i] === "+" || src[i] === "-") {
				const op = src[i++] ?? "+";
				v = op === "+" ? v + term() : v - term();
			}
			return v;
		};

		return { result: expr(), expression };
	},
};

const dateTimeTool = {
	name: "get_datetime",
	description: "Get the current UTC date and time",
	inputSchema: { type: "object", properties: {} },
	execute: async () => ({ utc: new Date().toISOString() }),
};

// =============================================================================
// Event handler (streaming output to terminal)
// =============================================================================

function onEvent(event: AgentEvent): void {
	switch (event.type) {
		case "iteration_start":
			console.log(`\n── Iteration ${event.iteration} ──`);
			break;
		case "content_start":
			if (event.contentType === "text") process.stdout.write(event.text ?? "");
			if (event.contentType === "tool")
				console.log(`\n[tool] ${event.toolName}…`);
			break;
		case "content_end":
			if (event.contentType === "tool" && !event.error)
				console.log(`[tool] done in ${event.durationMs}ms`);
			break;
		case "done":
			console.log(
				`\n── Done (${event.reason}, ${event.iterations} iterations) ──`,
			);
			break;
		case "error":
			console.error(`[error] ${event.error.message}`);
			break;
	}
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
	if (!API_KEY) {
		console.error("Set ANTHROPIC_API_KEY and try again.");
		process.exit(1);
	}

	// The spawn_agent tool lets the LLM create child agents on the fly.
	// Child agents get a focused system prompt but no spawn tool (prevents recursion).
	const spawnTool = createSpawnAgentTool({
		providerId: PROVIDER,
		modelId: MODEL,
		apiKey: API_KEY,
		defaultMaxIterations: 5,
	});

	const orchestrator = new Agent({
		providerId: PROVIDER,
		modelId: MODEL,
		apiKey: API_KEY,
		systemPrompt: `You are an orchestrator. For specialized work, spawn a sub-agent with
an appropriate system prompt via spawn_agent. Otherwise handle tasks directly.
Available tools: spawn_agent, calculate, get_datetime.`,
		tools: [spawnTool as never, calculatorTool, dateTimeTool],
		maxIterations: 20,
		onEvent,
	});

	const task = `Please do three things:
1. What is 2 ** 10 + 144 / 12?
2. What's today's UTC date?
3. Spawn a creative writing agent and ask it for a two-sentence story about a robot who discovers music.`;

	console.log("Task:", task);
	console.log("=".repeat(60));

	const result = await orchestrator.run(task);

	console.log(`\n${"=".repeat(60)}`);
	console.log("Final answer:\n");
	console.log(result.text);
	console.log(
		`\nTokens: ${result.usage.inputTokens + result.usage.outputTokens} | Tool calls: ${result.toolCalls.length}`,
	);
}

main().catch(console.error);
