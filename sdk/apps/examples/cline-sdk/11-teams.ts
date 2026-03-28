/**
 * 11-teams.ts
 *
 * Learn how to coordinate multi-agent teams.
 *
 * This example shows how to:
 * - Create agent teams with defined roles
 * - Coordinate work between team members
 * - Use team persistence and state management
 * - Implement collaborative workflows
 * - Handle team dynamics and communication
 *
 * Teams provide:
 * - Persistent state across sessions
 * - Role-based specialization
 * - Coordinated multi-agent workflows
 * - Shared context and history
 * - Team-level strategies (sequential, parallel, etc.)
 *
 * Prerequisites:
 * - Set ANTHROPIC_API_KEY environment variable
 *
 * Run: bun run 11-teams.ts
 */

import { ClineCore } from "@clinebot/core";

async function demoBasicTeam() {
	console.log("\n=== Basic Agent Team ===\n");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),

			// Enable teams capability
			enableAgentTeams: true,
			enableSpawnAgent: false,
			enableTools: true,

			// Define a team name for persistence
			teamName: "code-review-team",

			systemPrompt: `You are a team leader coordinating a code review team.

Your team members can help with:
- Code analysis
- Security review
- Performance optimization
- Documentation

Delegate tasks to appropriate team members and synthesize their findings.`,
		},

		prompt:
			"Review the 01-minimal.ts file for code quality, security, and documentation.",

		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoSoftwareDevTeam() {
	console.log("\n=== Software Development Team ===\n");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableAgentTeams: true,
			enableSpawnAgent: false,
			enableTools: true,
			teamName: "dev-team",

			// Allow more iterations for complex team coordination
			maxIterations: 30,

			systemPrompt: `You are leading a software development team with these roles:

1. Backend Developer - Focuses on server-side logic and APIs
2. Frontend Developer - Focuses on UI/UX and client-side code
3. QA Engineer - Tests and validates functionality
4. Tech Lead - Reviews architecture and best practices

Coordinate the team to build features end-to-end.`,
		},

		prompt: `Design and outline (don't implement) a user authentication feature:
1. Backend engineer: Design the API endpoints and database schema
2. Frontend engineer: Design the login/signup UI
3. QA engineer: Create test cases
4. Tech lead: Review and provide architectural guidance

Coordinate the team to produce a comprehensive plan.`,

		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoResearchTeam() {
	console.log("\n=== Research & Analysis Team ===\n");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableAgentTeams: true,
			enableSpawnAgent: false,
			enableTools: true,
			teamName: "research-team",

			systemPrompt: `You lead a research team analyzing codebases:

Team members:
1. Static Analysis Specialist - Examines code structure and patterns
2. Dependency Analyst - Reviews dependencies and versions
3. Documentation Reviewer - Evaluates documentation quality
4. Best Practices Auditor - Checks against industry standards

Assign tasks based on each member's expertise.`,
		},

		prompt: "Conduct a comprehensive analysis of this SDK examples library.",

		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoTeamPersistence() {
	console.log("\n=== Team Persistence Across Sessions ===\n");

	// Session 1: Start team work
	const manager1 = await ClineCore.create({});

	const result1 = await manager1.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableAgentTeams: true,
			enableSpawnAgent: false,
			enableTools: true,

			// Named team for persistence
			teamName: "persistent-team",

			systemPrompt:
				"You lead a team working on a multi-phase project. Remember context between sessions.",
		},

		prompt: "Phase 1: Analyze the package.json and note all dependencies.",

		interactive: true,
	});

	console.log("Phase 1 completed:");
	console.log(result1.result?.text);

	const sessionId = result1.sessionId;

	// Session 2: Continue with same team
	console.log("\n--- Continuing with same team ---\n");

	const result2 = await manager1.send({
		sessionId,
		prompt:
			"Phase 2: Based on the dependencies from Phase 1, identify which ones are for TypeScript development.",
	});

	console.log("Phase 2 completed:");
	console.log(result2?.text);

	await manager1.dispose();
}

async function demoTeamCoordination() {
	console.log("\n=== Complex Team Coordination ===\n");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableAgentTeams: true,
			enableSpawnAgent: false,
			enableTools: true,
			teamName: "coordination-demo",
			maxIterations: 35,

			systemPrompt: `You are orchestrating a complex project with multiple teams:

Team Structure:
- Planning Team: Defines requirements and milestones
- Implementation Team: Writes code and builds features
- Quality Team: Tests and validates work
- Documentation Team: Creates user guides and API docs

Coordinate work sequentially:
1. Planning defines what to build
2. Implementation builds it
3. Quality validates it
4. Documentation documents it

Ensure each team completes their work before the next begins.`,
		},

		prompt:
			"Plan and outline (don't implement) adding a new 'weather_tool' example to this library.",

		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoTeamWithSpawn() {
	console.log("\n=== Teams + Spawn Agents ===\n");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableAgentTeams: true,
			enableSpawnAgent: true,
			enableTools: true,
			teamName: "hybrid-team",
			maxIterations: 30,

			systemPrompt: `You lead a hybrid coordination model:
- Use TEAMS for roles that need context and collaboration
- Use SPAWN for independent, parallelizable tasks

Teams are great for:
- Sequential workflows with handoffs
- Maintaining context across phases
- Role-based specialization

Spawn is great for:
- Parallel independent tasks
- One-off specialized analysis
- Isolated subtasks

Choose the right coordination model for each task.`,
		},

		prompt:
			"Perform a complete audit of example files 01-04: Use teams for coordinated review and spawn for parallel file analysis.",

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

	await demoBasicTeam();
	await demoSoftwareDevTeam();
	await demoResearchTeam();
	await demoTeamPersistence();
	await demoTeamCoordination();
	await demoTeamWithSpawn();

	console.log("\n✅ All team coordination demos completed!");
	console.log("\n💡 Tips for using agent teams:");
	console.log("   • Teams persist state across sessions (named teams)");
	console.log("   • Great for sequential workflows with handoffs");
	console.log("   • Each team member maintains role and context");
	console.log("   • Team state stored in ~/.cline/data/teams/");
	console.log("   • Combine with spawn_agent for hybrid coordination");
	console.log("   • Use clear role definitions in system prompts");
	console.log("   • Consider team vs spawn tradeoffs for your use case");
}

main().catch(console.error);
