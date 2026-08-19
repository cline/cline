import type { AgentExtension, AgentHooks } from "@cline/shared";

export function createAgentHooksExtension(
	name: string,
	hooks: AgentHooks | undefined,
): AgentExtension | undefined {
	if (!hooks) {
		return undefined;
	}
	return {
		name,
		manifest: { capabilities: ["hooks"] },
		hooks,
	};
}
