#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHarnessServer } from "./server.mjs";

const server = await createHarnessServer({ port: 0 });
try {
	const response = await fetch(`${server.origin}/v1/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model: "harness/baseline",
			stream: true,
			messages: [{ role: "user", content: "stress the harness" }],
			tools: [
				{
					type: "function",
					function: { name: "run_commands", parameters: { type: "object" } },
				},
			],
		}),
	});
	const text = await response.text();
	const command = extractCommand(text);
	const child = spawn(command, { shell: true, stdio: "inherit" });
	const [exitCode] = await once(child, "exit");
	if (exitCode !== 0)
		throw new Error(`Callback command exited with ${exitCode}`);
	const marker = server.traces.find(
		(entry) => entry.event === "command_callback_received",
	);
	if (!marker) throw new Error("Callback marker was not recorded");
	process.stdout.write(
		`Harness smoke passed: trace=${marker.traceId}, callback=${marker.elapsedMs}ms\n`,
	);
} finally {
	await server.close();
}

function extractCommand(sse) {
	let argumentsText = "";
	for (const block of sse.split("\n\n")) {
		if (!block.startsWith("data: ") || block === "data: [DONE]") continue;
		const chunk = JSON.parse(block.slice(6));
		argumentsText +=
			chunk.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments ?? "";
	}
	return JSON.parse(argumentsText).commands[0];
}
