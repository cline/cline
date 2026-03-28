/**
 * 03-system-prompt.ts
 *
 * Learn how to customize agent behavior with system prompts.
 *
 * This example shows how to:
 * - Write effective system prompts
 * - Create specialized agents (code reviewer, architect, etc.)
 * - Control response style and format
 * - Add domain-specific knowledge
 *
 * Prerequisites:
 * - Set ANTHROPIC_API_KEY environment variable
 *
 * Run: bun run 03-system-prompt.ts
 */

import { ClineCore } from "@clinebot/core";

async function demoBasicSystemPrompt() {
	console.log("\n=== Basic System Prompt ===");

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

			// Simple, clear system prompt
			systemPrompt:
				"You are a helpful coding assistant. Always provide practical, working code examples.",
		},
		prompt: "How do I read a file in Node.js?",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoSpecializedAgent() {
	console.log("\n=== Specialized Agent: Code Reviewer ===");

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

			// Specialized system prompt with clear role definition
			systemPrompt: `You are an expert code reviewer focused on:
- Code quality and maintainability
- Security vulnerabilities
- Performance optimization opportunities
- Best practices for the language/framework

Provide constructive, actionable feedback with specific examples.
Format your reviews with clear sections: Strengths, Issues, and Recommendations.`,
		},
		prompt: `Review this TypeScript function:

async function fetchUser(id) {
  const response = await fetch('https://api.example.com/users/' + id);
  return response.json();
}`,
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoStyleControl() {
	console.log("\n=== Style Control: Concise vs Detailed ===");

	// Concise style
	const conciseManager = await ClineCore.create({});
	const conciseResult = await conciseManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			systemPrompt:
				"You are a coding assistant. Keep all responses under 3 sentences. Be direct and practical.",
		},
		prompt: "Explain what a Promise is in JavaScript.",
		interactive: false,
	});

	console.log("Concise Response:");
	console.log(conciseResult.result?.text);
	await conciseManager.dispose();

	console.log("\n---\n");

	// Detailed style
	const detailedManager = await ClineCore.create({});
	const detailedResult = await detailedManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			systemPrompt: `You are an expert programming tutor. Provide comprehensive explanations with:
1. Conceptual overview
2. Practical code examples
3. Common pitfalls and best practices
4. Real-world use cases`,
		},
		prompt: "Explain what a Promise is in JavaScript.",
		interactive: false,
	});

	console.log("Detailed Response:");
	console.log(detailedResult.result?.text);
	await detailedManager.dispose();
}

async function demoArchitectAgent() {
	console.log("\n=== Domain Expert: Software Architect ===");

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

			systemPrompt: `You are a senior software architect with 15+ years of experience.

Your expertise includes:
- Distributed systems design
- Microservices architecture
- Database schema design
- Scalability and performance
- Security best practices

When asked about architecture:
1. Consider scalability, maintainability, and cost
2. Suggest multiple approaches with trade-offs
3. Recommend specific technologies when appropriate
4. Point out potential risks and mitigation strategies

Be pragmatic and business-focused.`,
		},
		prompt:
			"Design a backend architecture for a real-time chat application with 100k+ concurrent users.",
		interactive: false,
	});

	console.log(result.result?.text);
	await sessionManager.dispose();
}

async function demoWithDomainKnowledge() {
	console.log("\n=== Domain Knowledge: Blockchain Expert ===");

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

			systemPrompt: `You are a blockchain and smart contract security expert.

Key principles you follow:
- Security first: Always consider attack vectors
- Gas optimization: Suggest efficient Solidity patterns
- Best practices: Follow OpenZeppelin standards
- Audit mindset: Think like an attacker

When reviewing contracts:
- Check for reentrancy vulnerabilities
- Verify access controls
- Look for integer overflow/underflow
- Assess gas costs
- Suggest testing strategies`,
		},
		prompt:
			"Review this Solidity transfer function for security issues: function transfer(address to, uint256 amount) public { balances[msg.sender] -= amount; balances[to] += amount; }",
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

	await demoBasicSystemPrompt();
	await demoSpecializedAgent();
	await demoStyleControl();
	await demoArchitectAgent();
	await demoWithDomainKnowledge();

	console.log("\n✅ All system prompt demos completed!");
}

main().catch(console.error);
