/**
 * 10-spawn-agents.ts
 *
 * Learn how to use spawn_agent for parallel sub-tasks.
 *
 * This example shows how to:
 * - Enable spawn_agent capability
 * - Delegate sub-tasks to spawned agents
 * - Handle parallel agent execution
 * - Aggregate results from multiple agents
 * - Use specialized agents for different tasks
 *
 * The spawn_agent tool lets the agent create sub-agents with custom:
 * - System prompts
 * - Tool access
 * - Iteration limits
 * - Focused objectives
 *
 * Prerequisites:
 * - Set ANTHROPIC_API_KEY environment variable
 *
 * Run: bun run 10-spawn-agents.ts
 */

import { ClineCore } from "@clinebot/core";

async function demoBasicSpawn() {
	console.log("\n=== Basic Agent Spawning ===\n");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),

			// Enable spawn_agent capability
			enableSpawnAgent: true,
			enableTools: true,
			enableAgentTeams: false,

			systemPrompt: `You are a project manager AI. You can delegate tasks to specialized sub-agents using the spawn_agent tool.

When you need to work on multiple independent tasks, spawn separate agents for each task.`,
		},

		prompt: `Analyze this example library and create:
1. A summary of all beginner examples (01-04)
2. A summary of all intermediate examples (05-09)

Spawn separate agents for each task to work in parallel.`,

		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoSpecializedSpawn() {
	console.log("\n=== Specialized Spawned Agents ===\n");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableSpawnAgent: true,
			enableTools: true,
			enableAgentTeams: false,

			systemPrompt: `You are a software architect. You can spawn specialized agents for different analysis tasks:
- Code quality agent: Reviews code structure and patterns
- Security agent: Checks for security issues
- Performance agent: Analyzes performance implications
- Documentation agent: Reviews documentation quality

Use spawn_agent with specific system prompts to create these specialized agents.`,
		},

		prompt: `Perform a comprehensive analysis of 01-minimal.ts:
1. Code quality review
2. Security analysis
3. Performance considerations
4. Documentation assessment

Spawn a specialized agent for each analysis type.`,

		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoParallelDataProcessing() {
	console.log("\n=== Parallel Data Processing ===\n");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableSpawnAgent: true,
			enableTools: true,
			enableAgentTeams: false,

			systemPrompt: `You are a data processing coordinator. You can spawn agents to process data in parallel.

For large datasets or multiple independent tasks, spawn separate agents to:
- Process data in parallel
- Reduce overall execution time
- Handle specialized processing logic

Each spawned agent can focus on a specific subset or aspect of the work.`,
		},

		prompt: `Analyze all the example files and extract:
1. All unique import statements
2. All function signatures
3. All code comments/documentation

Process these in parallel using spawned agents.`,

		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoErrorHandlingWithSpawn() {
	console.log("\n=== Error Handling with Spawned Agents ===\n");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableSpawnAgent: true,
			enableTools: true,
			enableAgentTeams: false,

			systemPrompt: `You are a resilient task coordinator. When spawning agents:
- Set appropriate iteration limits
- Handle agent failures gracefully
- Provide fallback strategies
- Aggregate results even if some agents fail

If a spawned agent encounters an error, explain the issue and continue with other tasks.`,
		},

		prompt: `Try to:
1. Read package.json and summarize dependencies
2. Read a file that doesn't exist (nonexistent.txt)
3. List all TypeScript files

Spawn agents for each task and handle any errors gracefully.`,

		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoRecursiveSpawn() {
	console.log("\n=== Recursive Agent Spawning ===\n");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableSpawnAgent: true,
			enableTools: true,
			enableAgentTeams: false,

			// Allow more iterations for complex recursive tasks
			maxIterations: 20,

			systemPrompt: `You are a hierarchical task manager. You can spawn agents, and those agents can spawn their own sub-agents.

Use this for complex tasks that break down into:
1. High-level objectives
2. Mid-level tasks
3. Low-level operations

Be mindful of depth to avoid excessive recursion.`,
		},

		prompt: `Analyze the examples directory structure:
1. First, spawn an agent to scan all example files
2. That agent should spawn sub-agents for each category (beginner, intermediate, advanced)
3. Each sub-agent should analyze its files and report back

Please coordinate this hierarchical analysis.`,

		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoSpawnWithCustomTools() {
	console.log("\n=== Spawned Agents with Limited Tools ===\n");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableSpawnAgent: true,
			enableTools: true,
			enableAgentTeams: false,

			systemPrompt: `You are a security-conscious coordinator. When spawning agents:
- Read-only agents: Can only read files and search
- Execution agents: Can run commands but need approval
- Analysis agents: No tools, pure reasoning

Spawn the right type of agent for each task based on requirements.`,
		},

		prompt: `Perform a safe code review:
1. Spawn a read-only agent to read and analyze code
2. Don't allow any modifications or command execution
3. Report findings without changing anything`,

		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function main() {
	if (!process.env.ANTHROPIC_API_KEY) {
		console.error("Please set ANTHROPIC_API_KEY environment variable");
		process.exit(1);
	}

	await demoBasicSpawn();
	await demoSpecializedSpawn();
	await demoParallelDataProcessing();
	await demoErrorHandlingWithSpawn();
	await demoRecursiveSpawn();
	await demoSpawnWithCustomTools();

	console.log("\n✅ All spawn agent demos completed!");
	console.log("\n💡 Tips for using spawn_agent:");
	console.log("   • Use for truly independent parallel tasks");
	console.log("   • Each spawned agent has its own context and tools");
	console.log(
		"   • Set appropriate iteration limits to prevent runaway execution",
	);
	console.log(
		"   • Spawned agents are automatically cleaned up after completion",
	);
	console.log("   • Great for divide-and-conquer strategies");
	console.log("   • Can create specialized agents with custom system prompts");
}

main().catch(console.error);
