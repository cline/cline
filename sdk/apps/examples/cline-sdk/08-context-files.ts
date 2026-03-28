/**
 * 08-context-files.ts
 *
 * Learn how to add context files to agent sessions.
 *
 * This example shows how to:
 * - Attach files as context to prompts
 * - Reference files in conversations
 * - Work with multiple file attachments
 * - Handle different file types
 *
 * Prerequisites:
 * - Set ANTHROPIC_API_KEY environment variable
 *
 * Run: bun run 08-context-files.ts
 */

import { ClineCore } from "@clinebot/core";

async function demoSingleFile() {
	console.log("\n=== Single File Context ===\n");

	const sessionManager = await ClineCore.create({});

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
				"You are a helpful coding assistant. Analyze the provided files.",
		},

		// Attach a single file
		userFiles: ["package.json"],

		prompt:
			"What is the main purpose of this project based on the package.json?",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoMultipleFiles() {
	console.log("\n=== Multiple Files Context ===\n");

	const sessionManager = await ClineCore.create({});

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
				"You are a helpful assistant. Analyze the provided files together.",
		},

		// Attach multiple files
		userFiles: ["package.json", "README.md", "tsconfig.json"],

		prompt:
			"Based on these configuration files, describe the project setup and technology stack.",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoCodeAnalysis() {
	console.log("\n=== Code Analysis with Context ===\n");

	const sessionManager = await ClineCore.create({});

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
				"You are an expert code reviewer. Analyze the provided source files for quality and best practices.",
		},

		// Attach source files for analysis
		userFiles: ["01-minimal.ts", "02-custom-model.ts"],

		prompt:
			"Review these example files. Are they well-structured? Any improvements you'd suggest?",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoDocumentationGeneration() {
	console.log("\n=== Documentation Generation ===\n");

	const sessionManager = await ClineCore.create({});

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
				"You are a technical writer. Generate clear, concise documentation.",
		},

		userFiles: ["01-minimal.ts"],

		prompt: `Generate comprehensive documentation for this example file including:
1. Overview
2. Prerequisites
3. Step-by-step explanation of each section
4. Common issues and solutions`,
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoRefactoringWithContext() {
	console.log("\n=== Refactoring with Context ===\n");

	const sessionManager = await ClineCore.create({});

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
				"You are a refactoring expert. Suggest improvements while maintaining functionality.",
		},

		userFiles: ["04-tools.ts"],

		prompt:
			"Review this file and suggest refactoring opportunities to improve code organization and reusability.",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoInteractiveWithFiles() {
	console.log("\n=== Interactive Session with File Context ===\n");

	const sessionManager = await ClineCore.create({});

	// Start session with initial files
	const startResult = await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			systemPrompt:
				"You are a helpful coding assistant. Reference the files provided in previous messages.",
		},
		userFiles: ["package.json"],
		prompt: "What dependencies does this project use?",
		interactive: true, // Enable interactive mode
	});

	console.log("Initial response:");
	console.log(startResult.result?.text);

	// Continue conversation with additional files
	const continueResult = await sessionManager.send({
		sessionId: startResult.sessionId,
		prompt: "Now look at the README and tell me how to run the examples.",
		userFiles: ["README.md"],
	});

	console.log("\nFollow-up response:");
	console.log(continueResult?.text);

	await sessionManager.dispose();
}

async function demoLargeContextProject() {
	console.log("\n=== Large Context with Multiple Files ===\n");

	const sessionManager = await ClineCore.create({});

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
				"You are a software architect. Analyze project structure and architecture.",
			maxIterations: 15, // Allow more iterations for complex analysis
		},

		// Attach multiple files for comprehensive analysis
		userFiles: [
			"README.md",
			"package.json",
			"01-minimal.ts",
			"02-custom-model.ts",
			"03-system-prompt.ts",
			"04-tools.ts",
		],

		prompt: `Analyze this example library:
1. What patterns are used across examples?
2. How does complexity progress from beginner to advanced?
3. What additional examples would be valuable?
4. Are there any gaps in the learning path?`,
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

	await demoSingleFile();
	await demoMultipleFiles();
	await demoCodeAnalysis();
	await demoDocumentationGeneration();
	await demoRefactoringWithContext();
	await demoInteractiveWithFiles();
	await demoLargeContextProject();

	console.log("\n✅ All context file demos completed!");
	console.log("\n💡 Tips for using file context:");
	console.log("   • Attach relevant files to provide full context");
	console.log("   • Use relative paths from the cwd");
	console.log("   • Consider file size and token limits");
	console.log("   • Combine with interactive mode for iterative analysis");
}

main().catch(console.error);
