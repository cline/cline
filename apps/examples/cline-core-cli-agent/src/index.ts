import * as readline from "node:readline";
import {
	type AgentEvent,
	ClineCore,
	type ToolApprovalRequest,
} from "@cline/sdk";

// ClineCore does not choose a model automatically; each session config must provide one.
// These example defaults use the Cline gateway with Claude Sonnet, and can be overridden with env vars.
const providerId = process.env.CLINE_PROVIDER_ID ?? "cline";
const modelId = process.env.CLINE_MODEL_ID ?? "anthropic/claude-sonnet-4.6";
const apiKey = process.env.CLINE_API_KEY;
const cwd = process.cwd();

const systemPrompt = `You are a helpful assistant in an interactive terminal chat.
Be concise. You can use built-in tools to inspect files, search the workspace, and run shell commands when helpful.`;

let cline: ClineCore | undefined;
let unsubscribe: (() => void) | undefined;
let activeSessionId: string | undefined;
let hasPrintedAssistantPrefix = false;

function printAssistantPrefix(): void {
	if (!hasPrintedAssistantPrefix) {
		process.stdout.write("\nagent: ");
		hasPrintedAssistantPrefix = true;
	}
}

function formatToolValue(value: unknown): string {
	const output =
		typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
	return output.length > 200 ? `${output.slice(0, 200)}...` : output;
}

function handleAgentEvent(event: AgentEvent): void {
	switch (event.type) {
		case "content_start":
			if (event.contentType === "text" && event.text) {
				printAssistantPrefix();
				process.stdout.write(event.text);
			}
			if (event.contentType === "tool" && event.toolName) {
				console.log(
					`\n[tool] ${event.toolName}(${JSON.stringify(event.input ?? {})})`,
				);
			}
			break;
		case "content_update":
			if (event.contentType === "tool" && event.toolName) {
				console.log(
					`[update] ${event.toolName}: ${formatToolValue(event.update)}`,
				);
			}
			break;
		case "content_end":
			if (event.contentType === "tool" && event.toolName) {
				if (event.error) {
					console.log(`[error] ${event.toolName}: ${event.error}`);
				} else {
					console.log(`[result] ${formatToolValue(event.output)}`);
				}
			}
			break;
		case "notice":
			console.log(`\n[notice] ${event.message}`);
			break;
		case "error":
			console.error(`\n[error] ${event.error.message}`);
			break;
	}
}

async function ensureCline(): Promise<ClineCore> {
	if (cline) {
		return cline;
	}

	cline = await ClineCore.create({
		clientName: "cline-core-cli-agent",
		backendMode: "local",
		capabilities: {
			requestToolApproval,
		},
	});
	unsubscribe = cline.subscribe((event) => {
		if (event.type === "agent_event") {
			handleAgentEvent(event.payload.event);
		}
	});
	return cline;
}

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function ask(question: string): Promise<string> {
	return new Promise((resolve) => {
		rl.question(question, resolve);
	});
}

async function requestToolApproval(request: ToolApprovalRequest) {
	console.log(`\n[approval] ${request.toolName} wants to run:`);
	console.log(formatToolValue(request.input));
	const answer = await ask("Approve? [y/N] ");
	const approved = answer.trim().toLowerCase() === "y";
	return {
		approved,
		...(approved ? {} : { reason: "User denied tool execution" }),
	};
}

function prompt(): Promise<string> {
	return ask("\nyou: ");
}

async function startSession(): Promise<string> {
	const runtime = await ensureCline();
	const result = await runtime.start({
		source: "cli",
		interactive: true,
		config: {
			providerId,
			modelId,
			apiKey,
			cwd,
			workspaceRoot: cwd,
			mode: "act",
			systemPrompt,
			maxIterations: 10,
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			disableMcpSettingsTools: true,
		},
		toolPolicies: {
			"*": { autoApprove: false },
			read_files: { autoApprove: true },
			search_codebase: { autoApprove: true },
		},
	});
	return result.sessionId;
}

async function runTurn(input: string): Promise<void> {
	activeSessionId ??= await startSession();
	hasPrintedAssistantPrefix = false;
	const runtime = await ensureCline();
	await runtime.send({
		sessionId: activeSessionId,
		prompt: input,
	});
	console.log();
}

console.log("ClineCore CLI Agent (type 'exit' to quit)\n");
console.log(`Provider: ${providerId}`);
console.log(`Model:    ${modelId}`);
console.log(`CWD:      ${cwd}`);

try {
	while (true) {
		const input = await prompt();
		const trimmed = input.trim();
		if (trimmed.toLowerCase() === "exit") {
			break;
		}
		if (!trimmed) {
			continue;
		}

		await runTurn(trimmed);
	}
} finally {
	rl.close();
	unsubscribe?.();
	if (activeSessionId && cline) {
		await cline.stop(activeSessionId).catch(() => undefined);
	}
	await cline?.dispose();
	console.log("Goodbye!");
}
