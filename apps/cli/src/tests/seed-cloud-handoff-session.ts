import { ClineCore, SessionSource } from "@cline/core";

// Bootstrap persistence through the real core without sending an LLM request.
const core = await ClineCore.create({ backendMode: "local" });
try {
	const session = await core.start({
		source: SessionSource.CLI,
		interactive: true,
		config: {
			sessionId: "fixture-local-handoff",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "fixture-local-key",
			cwd: process.cwd(),
			workspaceRoot: process.cwd(),
			systemPrompt: "Local handoff fixture",
			enableTools: false,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		},
		initialMessages: [
			{ role: "user", content: "Preserve the local handoff context." },
			{
				role: "assistant",
				content: "The local plan is ready to continue remotely.",
			},
		],
	});
	await core.stop(session.sessionId);
} finally {
	await core.dispose("handoff_fixture_seeded");
}
