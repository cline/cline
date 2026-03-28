/**
 * 01-minimal.ts
 *
 * The simplest possible Cline SDK example.
 *
 * This example shows how to:
 * - Create a session manager
 * - Run a single prompt
 * - Get the result
 *
 * Prerequisites:
 * - Set ANTHROPIC_API_KEY environment variable
 *
 * Run: bun run 01-minimal.ts
 */

import { ClineCore } from "@clinebot/core";

async function main() {
	// Create a session manager (handles all session lifecycle)
	const sessionManager = await ClineCore.create({});

	// Start a session with minimal configuration
	const result = await sessionManager.start({
		config: {
			// Provider configuration
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY || "",

			// Working directory (agent can read/write files here)
			cwd: process.cwd(),

			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,

			// System prompt defines agent behavior
			systemPrompt: "You are a helpful coding assistant.",
		},

		// User prompt
		prompt: "Hello! What can you help me with?",

		// Interactive mode (false = one-shot response)
		interactive: false,
	});

	// Print the result
	console.log("\n=== Agent Response ===");
	console.log(result.result?.text);

	// Clean up
	await sessionManager.dispose();
}

main().catch(console.error);
