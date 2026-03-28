/**
 * 02-custom-model.ts
 *
 * Learn how to configure different models and providers.
 *
 * This example shows how to:
 * - Use different AI providers (Anthropic, OpenAI, Google, etc.)
 * - Select specific models
 * - Configure model-specific settings (thinking, temperature, etc.)
 * - Set iteration limits
 *
 * Prerequisites:
 * - Set API key for your chosen provider (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
 *
 * Run: bun run 02-custom-model.ts
 */

import { ClineCore } from "@clinebot/core";

async function demoAnthropicModel() {
	console.log("\n=== Anthropic Claude Sonnet ===");

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

			// Enable extended thinking (for supported models)
			thinking: true,

			// Maximum iterations before stopping (prevents infinite loops)
			maxIterations: 10,

			systemPrompt: "You are a concise coding assistant.",
		},
		prompt: "What's the best way to handle async errors in TypeScript?",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoOpenAIModel() {
	console.log("\n=== OpenAI GPT-4 ===");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "openai",
			modelId: "gpt-4",
			apiKey: process.env.OPENAI_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,

			// Limit iterations for faster responses
			maxIterations: 5,

			systemPrompt: "You are a helpful assistant. Keep responses brief.",
		},
		prompt: "Explain promises in JavaScript in 2 sentences.",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoGeminiModel() {
	console.log("\n=== Google Gemini ===");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "google",
			modelId: "gemini-2-flash",
			apiKey: process.env.GEMINI_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,

			// Configure thinking mode
			thinking: false,
			maxIterations: 8,

			systemPrompt: "You are a helpful coding assistant.",
		},
		prompt: "What are the benefits of using TypeScript?",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoCustomBaseUrl() {
	console.log("\n=== Custom Base URL (e.g., OpenAI-compatible API) ===");

	const sessionManager = await ClineCore.create({});

	const result = await sessionManager.start({
		config: {
			providerId: "openai",
			modelId: "gpt-4",
			apiKey: process.env.OPENAI_API_KEY ?? "",

			// Use custom API endpoint (e.g., Azure OpenAI, local model server)
			baseUrl: "https://api.openai.com/v1",

			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			systemPrompt: "You are a helpful assistant.",
		},
		prompt: "Hello!",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function main() {
	// Run examples based on available API keys
	if (process.env.ANTHROPIC_API_KEY) {
		await demoAnthropicModel();
	}

	if (process.env.OPENAI_API_KEY) {
		await demoOpenAIModel();
	}

	if (process.env.GEMINI_API_KEY) {
		await demoGeminiModel();
	}

	if (process.env.OPENAI_API_KEY) {
		await demoCustomBaseUrl();
	}

	if (
		!process.env.ANTHROPIC_API_KEY &&
		!process.env.OPENAI_API_KEY &&
		!process.env.GEMINI_API_KEY
	) {
		console.error("Please set at least one API key:");
		console.error("  ANTHROPIC_API_KEY");
		console.error("  OPENAI_API_KEY");
		console.error("  GEMINI_API_KEY");
		process.exit(1);
	}

	console.log("\n✅ All demos completed!");
}

main().catch(console.error);
