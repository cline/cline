import { HarnessAgent, type HarnessAgentSession } from "@ai-sdk/harness/agent";
import { createCline } from "@ai-sdk/harness-cline";
import { createVercelSandbox } from "@ai-sdk/sandbox-vercel";
import { type AgentTUIAgent, runAgentTUI } from "@ai-sdk/tui";
import { loadConfig } from "./config";
import {
	instructions,
	mcpServers,
	onSession,
	skills,
	tools,
} from "./extensions";

const config = loadConfig();
const harness = createCline({
	...config.harness,
	mcpServers,
});

const agent = new HarnessAgent({
	harness,
	id: config.agent.id,
	instructions,
	tools,
	skills,
	permissionMode: config.agent.permissionMode,
	debug: { enabled: config.agent.debug },
	sandbox: createVercelSandbox({
		runtime: "node24",
	}),
	sandboxConfig: { onSession },
});

function bindSession(session: HarnessAgentSession): AgentTUIAgent {
	return {
		version: "agent-v1",
		id: agent.id,
		tools: agent.tools,
		generate(request) {
			return agent.generate({
				...request,
				session,
			} as Parameters<typeof agent.generate>[0]);
		},
		stream(request) {
			return agent.stream({
				...request,
				session,
			} as Parameters<typeof agent.stream>[0]);
		},
	} as AgentTUIAgent;
}

const session = await agent.createSession();

try {
	await runAgentTUI({
		...config.tui,
		agent: bindSession(session),
	});
} finally {
	await session.destroy();
}
