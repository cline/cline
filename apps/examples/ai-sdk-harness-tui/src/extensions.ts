import type {
	HarnessAgentSandboxConfig,
	HarnessAgentSkill,
} from "@ai-sdk/harness/agent";
import type { ToolSet } from "ai";

/** Host-executed AI SDK tools. User tools override same-named harness tools. */
export const tools = {} satisfies ToolSet;

/** Reusable instructions that the harness can load on demand. */
export const skills: HarnessAgentSkill[] = [];

/** Application-specific behavior appended to Cline's native instructions. */
export const instructions = `Be concise and honest. Write down notes in ./.cline/notes/ as you work on large tasks that require multiple iterations so keep user and other agents informed.`;

/** Native Cline MCP server definitions, keyed by server name. */
export const mcpServers: Record<string, unknown> = {};

/** Prepare files or configuration for every sandbox session. */
export const onSession: HarnessAgentSandboxConfig["onSession"] = async () => {
	// Keep additions idempotent so resumed sessions are safe.
};
