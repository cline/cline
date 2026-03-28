/**
 * 04-tools.ts
 *
 * Learn how to use built-in tools with the Cline SDK.
 *
 * This example shows how to:
 * - Enable/disable tools
 * - Use built-in tools (read_files, search_codebase, run_commands, etc.)
 * - Configure tool policies (allowed, blocked, require approval)
 * - Handle tool approvals
 *
 * Built-in tools:
 * - read_files: Read one or more files
 * - search_codebase: Search code with regex/glob
 * - run_commands: Execute shell commands
 * - fetch_web_content: Fetch and analyze web pages
 * - ask_followup_question: Ask user for clarification
 * - editor: Advanced file editing operations
 * - skills: Execute configured workflow skills
 *
 * Prerequisites:
 * - Set ANTHROPIC_API_KEY environment variable
 *
 * Run: bun run 04-tools.ts
 */

import { ClineCore } from "@clinebot/core";

const POLICY_ALLOWED = { enabled: true, autoApprove: true };
const POLICY_BLOCKED = { enabled: false, autoApprove: false };
const POLICY_REQUIRE_APPROVAL = { enabled: true, autoApprove: false };

async function demoBasicTools() {
	console.log("\n=== Basic Tool Usage ===");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),

			// Tools are enabled by default
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,

			systemPrompt:
				"You are a helpful coding assistant. Use tools to help the user.",
		},
		prompt:
			"Read the package.json file in this directory and tell me the project name.",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoReadOnlyMode() {
	console.log("\n=== Read-Only Mode (Safe Exploration) ===");

	const sessionManager = await ClineCore.create({
		// Configure tool policies at the session manager level
		toolPolicies: {
			// Allow reading and searching
			read_files: POLICY_ALLOWED,
			search_codebase: POLICY_ALLOWED,

			// Block potentially dangerous operations
			run_commands: POLICY_BLOCKED,
			editor: POLICY_BLOCKED,
		},
	});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			systemPrompt:
				"You are a code analysis assistant. You can read and search files but cannot modify them or run commands.",
		},
		prompt:
			"Analyze the project structure and summarize what this codebase does.",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoToolApproval() {
	console.log("\n=== Tool Approval Workflow ===");

	const sessionManager = await ClineCore.create({
		toolPolicies: {
			// Allow safe operations
			read_files: POLICY_ALLOWED,

			// Require approval for potentially destructive operations
			run_commands: POLICY_REQUIRE_APPROVAL,
			editor: POLICY_REQUIRE_APPROVAL,
		},

		// Handle tool approval requests
		requestToolApproval: async (request) => {
			console.log("\n🔔 Tool Approval Request:");
			console.log(`  Tool: ${request.toolName}`);
			console.log(`  Input: ${JSON.stringify(request.input, null, 2)}`);

			// In a real application, you might:
			// - Show a UI dialog
			// - Check against security policies
			// - Log to audit trail
			// - Prompt user in CLI

			// For this demo, auto-approve with logging
			console.log("  ✅ Auto-approved for demo\n");

			return {
				approved: true,
				// Optionally provide feedback to the agent
				reason: "Command approved. Please be careful with file modifications.",
			};
		},
	});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			systemPrompt: "You are a helpful coding assistant.",
		},
		prompt:
			"Create a new file called test-demo.txt with the content 'Hello Cline SDK!'",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoNoTools() {
	console.log("\n=== No Tools (Pure Conversation) ===");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),

			// Disable all tools
			enableTools: false,
			enableSpawnAgent: false,
			enableAgentTeams: false,

			systemPrompt:
				"You are a helpful coding assistant. Answer based on your knowledge.",
		},
		prompt: "What are the best practices for error handling in Node.js?",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoSpecificTools() {
	console.log("\n=== Specific Tool Control ===");

	const sessionManager = await ClineCore.create({
		toolPolicies: {
			// Only allow file reading
			read_files: POLICY_ALLOWED,

			// Block everything else
			search_codebase: POLICY_BLOCKED,
			run_commands: POLICY_BLOCKED,
			fetch_web_content: POLICY_BLOCKED,
			editor: POLICY_BLOCKED,
			ask_followup_question: POLICY_BLOCKED,
			skills: POLICY_BLOCKED,
		},
	});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			systemPrompt:
				"You can only read files. If you need other capabilities, explain that to the user.",
		},
		prompt: "Read the README.md and summarize it in 3 bullet points.",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoWebFetchTool() {
	console.log("\n=== Web Fetch Tool ===");

	const sessionManager = await ClineCore.create({
		toolPolicies: {
			fetch_web_content: POLICY_ALLOWED,
		},
	});

	const result = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			systemPrompt:
				"You can fetch web content to answer questions. Be concise.",
		},
		prompt: "What's the latest version of Node.js? Check nodejs.org",
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

	await demoBasicTools();
	await demoReadOnlyMode();
	await demoToolApproval();
	await demoNoTools();
	await demoSpecificTools();
	await demoWebFetchTool();

	console.log("\n✅ All tool demos completed!");
}

main().catch(console.error);
