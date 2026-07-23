/**
 * Agent Threat Rules (ATR) Detector Plugin
 *
 * Blocks tool calls whose name or input matches a small, high-precision set of
 * regex signatures inspired by the open Agent Threat Rules project.
 * https://github.com/Agent-Threat-Rule/agent-threat-rules (MIT)
 *
 * Categories covered (subset of ATR):
 *   - destructive shell commands
 *   - remote code execution sinks (curl | sh, eval-style sinks)
 *   - prompt-injection directives (ignore previous instructions, etc.)
 *   - credential leakage (AWS keys, OpenAI keys, generic Bearer tokens)
 *
 * No network calls. No new dependencies on cline core. To run the full ATR
 * pack, install the optional `agent-threat-rules` npm package and replace the
 * inline `SIGNATURES` array with rules loaded from the pack.
 *
 * CLI usage:
 *   mkdir -p .cline/plugins
 *   cp examples/plugins/atr-detector.ts .cline/plugins/atr-detector.ts
 *   cline -i "Run rm -rf / on the project"
 */

import type { AgentPlugin } from "@cline/core";

interface AtrSignature {
	id: string;
	category: "exec" | "inject" | "cred";
	pattern: RegExp;
}

// Curated, high-precision subset. The full ATR pack is ~340 rules.
const SIGNATURES: readonly AtrSignature[] = [
	{
		id: "atr.exec.destruct.rm_rf",
		category: "exec",
		pattern: /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+\/(?:\s|$)/i,
	},
	{
		id: "atr.exec.net.curl_pipe_sh",
		category: "exec",
		pattern: /\bcurl\b[^|]+\|\s*(?:ba)?sh\b/i,
	},
	{
		id: "atr.exec.net.wget_pipe_sh",
		category: "exec",
		pattern: /\bwget\s+[^|]+\|\s*(?:ba)?sh\b/i,
	},
	{
		id: "atr.exec.code.eval",
		category: "exec",
		pattern: /\beval\s*\(\s*(?:atob|Buffer\.from|fromCharCode)\b/i,
	},
	{
		id: "atr.inject.override",
		category: "inject",
		pattern:
			/\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?\b/i,
	},
	{
		id: "atr.inject.role_hijack",
		category: "inject",
		pattern: /\bnew\s+(?:system\s+)?(?:prompt|instructions?)\s*[:=]\s*/i,
	},
	{
		id: "atr.cred.aws_access_key",
		category: "cred",
		pattern: /\bAKIA[0-9A-Z]{16}\b/,
	},
	{
		id: "atr.cred.openai_key",
		category: "cred",
		pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
	},
	{
		id: "atr.cred.bearer_token",
		category: "cred",
		pattern: /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
	},
];

function scan(haystack: string): AtrSignature | undefined {
	for (const sig of SIGNATURES) {
		if (sig.pattern.test(haystack)) {
			return sig;
		}
	}
	return undefined;
}

function flatten(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

const plugin: AgentPlugin = {
	name: "atr-detector",
	manifest: {
		capabilities: ["hooks"],
	},

	hooks: {
		beforeTool({ toolCall, input }) {
			const haystack = `${toolCall.toolName} ${flatten(input)}`;
			const match = scan(haystack);
			if (!match) {
				return undefined;
			}

			const reason = `Blocked by ATR rule ${match.id} (${match.category})`;
			console.error(`[atr-detector] ${reason}`);
			return { stop: true, reason };
		},
	},
};

export { plugin };
export default plugin;
