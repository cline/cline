import { type AgentEvent, ClineCore } from "@cline/sdk";

const defaultPrompt = "Explain what an SDK is in two sentences.";
const prompt = process.argv.slice(2).join(" ").trim() || defaultPrompt;

const cline = await ClineCore.create({
	clientName: "quickstart-clinecore",
	backendMode: "local",
});

const unsubscribe = cline.subscribe((event) => {
	if (event.type === "agent_event") {
		renderAgentEvent(event.payload.event);
	}
});

try {
	const result = await cline.start({
		source: "cli",
		interactive: false,
		prompt,
		config: {
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: process.env.CLINE_API_KEY,
			cwd: process.cwd(),
			workspaceRoot: process.cwd(),
			mode: "act",
			systemPrompt: "You are a helpful assistant. Be concise.",
			maxIterations: 10,
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			disableMcpSettingsTools: true,
		},
	});

	const usage = result.result?.usage;
	console.log(
		`\n\nDone (${result.result?.iterations ?? 0} iteration, ${usage?.outputTokens ?? 0} output tokens)`,
	);
	console.log(`Session: ${result.sessionId}`);
} finally {
	unsubscribe();
	await cline.dispose();
}

function renderAgentEvent(event: AgentEvent) {
	if (event.type !== "content_start" || event.contentType !== "text") {
		return;
	}

	process.stdout.write(event.text ?? "");
}
