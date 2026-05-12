import * as readline from "node:readline";
import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";

const agent = new Agent({
	providerId: "cline",
	modelId: "anthropic/claude-sonnet-4-6",
	apiKey: process.env.CLINE_API_KEY,
	systemPrompt: "You are a helpful assistant in a terminal chat. Be concise.",
	maxIterations: 10,
	tools: [
		createTool({
			name: "shell",
			description: "Run a shell command and return the output.",
			inputSchema: z.object({
				command: z.string().describe("The shell command to execute"),
			}),
			async execute(input) {
				const proc = Bun.spawn(["sh", "-c", input.command], {
					stdout: "pipe",
					stderr: "pipe",
				});
				const stdout = await new Response(proc.stdout).text();
				const stderr = await new Response(proc.stderr).text();
				await proc.exited;
				return { exitCode: proc.exitCode, stdout, stderr };
			},
		}),
	],
});

agent.subscribe((event) => {
	switch (event.type) {
		case "assistant-text-delta":
			process.stdout.write(event.text);
			break;
		case "tool-started":
			console.log(`\n[tool] ${event.toolCall.toolName}(${JSON.stringify(event.toolCall.input)})`);
			break;
		case "tool-finished": {
			const result = event.message.content.find((p) => p.type === "tool-result");
			if (result && result.type === "tool-result") {
				const output = typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);
				console.log(`[result] ${output.slice(0, 200)}${output.length > 200 ? "..." : ""}`);
			}
			break;
		}
	}
});

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function prompt(): Promise<string> {
	return new Promise((resolve) => {
		rl.question("\nyou: ", resolve);
	});
}

console.log("Cline CLI Agent (type 'exit' to quit)\n");

let isFirstMessage = true;
while (true) {
	const input = await prompt();
	if (input.trim().toLowerCase() === "exit") {
		break;
	}
	if (!input.trim()) {
		continue;
	}

	process.stdout.write("\nagent: ");
	if (isFirstMessage) {
		await agent.run(input);
		isFirstMessage = false;
	} else {
		await agent.continue(input);
	}
	console.log();
}

rl.close();
console.log("Goodbye!");
