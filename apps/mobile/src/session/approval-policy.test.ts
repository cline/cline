import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	APPROVAL_TIERS,
	type ApprovalPolicy,
	type ApprovalTier,
	classifyTool,
	DEFAULT_APPROVAL_POLICY,
	shouldAutoApprove,
} from "./approval-policy";

/** Every tool name we recognise, paired with the tier it must land in. */
const CLASSIFICATION_TABLE: Array<[string, ApprovalTier]> = [
	// read tier — inspect the workspace, cannot change it
	["read_file", "read"],
	["read_files", "read"],
	["search_files", "read"],
	["search_codebase", "read"],
	["list_code_definition_names", "read"],
	// write tier — mutate files in the workspace
	["replace_in_file", "write"],
	["write_to_file", "write"],
	["editor", "write"],
	["apply_patch", "write"],
	["apply_diff", "write"],
	// execute tier — run arbitrary commands, reach the network, run skills
	["bash", "execute"],
	["run_commands", "execute"],
	["execute_command", "execute"],
	// `list_files` is an *alias* for the arbitrary-shell tool, not a directory
	// listing — see the alias-drift guard below.
	["list_files", "execute"],
	["fetch_web_content", "execute"],
	["skills", "execute"],
	["use_skill", "execute"],
];

const AUTO_APPROVABLE_NAMES = CLASSIFICATION_TABLE.filter(
	([, tier]) => tier !== "execute",
).map(([name]) => name);

// --- provenance / alias drift guards ----------------------------------------

const REPO_ROOT = new URL("../../../../", import.meta.url);

function readSdkSource(relativePath: string): string {
	const absolute = fileURLToPath(new URL(relativePath, REPO_ROOT).href);
	// Deliberately not tolerant of a missing file: these two files are the sources
	// of truth for the tier table, and if they move the table MUST be re-derived
	// by hand rather than silently trusted.
	return readFileSync(absolute, "utf8");
}

/**
 * The SDK's legacy-alias table, transcribed from
 * `sdk/packages/core/src/runtime/orchestration/runtime-builder.ts:90-101`
 * (`CONFIGURED_AGENT_TOOL_NAME_ALIASES`, which is module-private and therefore
 * not importable).
 *
 * `list_files -> run_commands` is the reason this guard exists: it reads like a
 * directory listing and resolves to arbitrary shell execution.
 */
const SDK_TOOL_NAME_ALIASES: Record<string, string> = {
	apply_diff: "editor",
	attempt_completion: "submit_and_exit",
	bash: "run_commands",
	execute_command: "run_commands",
	list_code_definition_names: "search_codebase",
	list_files: "run_commands",
	read_file: "read_files",
	replace_in_file: "editor",
	search_files: "search_codebase",
	use_skill: "skills",
	write_to_file: "editor",
};

/**
 * Canonical built-ins whose blast radius is arbitrary code or network egress:
 * `run_commands` runs shell (`definitions.ts:479`), `skills` executes a
 * configured skill (`definitions.ts:738`), `fetch_web_content` reaches the
 * network (`definitions.ts:525`). Nothing that resolves to one of these may sit
 * in `read` or `write`.
 */
const EXECUTE_CLASS_BUILTINS = new Set([
	"run_commands",
	"skills",
	"fetch_web_content",
]);

/** Canonical built-ins that only read or only edit files. */
const SAFE_BUILTIN_TIERS: Record<string, ApprovalTier> = {
	read_files: "read",
	search_codebase: "read",
	editor: "write",
	apply_patch: "write",
};

function parseSdkAliasMap(): Record<string, string> {
	const source = readSdkSource(
		"sdk/packages/core/src/runtime/orchestration/runtime-builder.ts",
	);
	const block = /CONFIGURED_AGENT_TOOL_NAME_ALIASES[^=]*=\s*\{([^}]*)\}/.exec(
		source,
	);
	if (!block?.[1]) {
		throw new Error(
			"CONFIGURED_AGENT_TOOL_NAME_ALIASES not found in runtime-builder.ts — re-derive the tier table by hand.",
		);
	}
	const aliases: Record<string, string> = {};
	for (const line of block[1].split("\n")) {
		const pair = /^\s*([a-z_]+)\s*:\s*"([a-z_]+)"\s*,?\s*$/.exec(line);
		if (pair?.[1] && pair[2]) {
			aliases[pair[1]] = pair[2];
		}
	}
	return aliases;
}

function parseSdkDefaultToolNames(): string[] {
	const source = readSdkSource(
		"sdk/packages/core/src/extensions/tools/constants.ts",
	);
	const block = /DefaultToolNames\s*=\s*\{([^}]*)\}/.exec(source);
	if (!block?.[1]) {
		throw new Error(
			"DefaultToolNames not found in constants.ts — re-derive the tier table by hand.",
		);
	}
	return [...block[1].matchAll(/:\s*"([a-z_]+)"/g)].map((match) => match[1]);
}

describe("tier table provenance", () => {
	it("keeps the transcribed alias map in step with the SDK's live one", () => {
		// If this fails the SDK's aliases drifted: every read/write entry must be
		// re-verified against the new table before the copy above is updated.
		expect(parseSdkAliasMap()).toEqual(SDK_TOOL_NAME_ALIASES);
	});

	it("never auto-approves a name that aliases to an execute-class tool", () => {
		for (const name of AUTO_APPROVABLE_NAMES) {
			const resolved = SDK_TOOL_NAME_ALIASES[name] ?? name;
			expect(
				EXECUTE_CLASS_BUILTINS.has(resolved),
				`${name} resolves to ${resolved}, which is execute-class`,
			).toBe(false);
		}
	});

	it("only auto-approves names that resolve to a shipped first-party builtin", () => {
		// Provenance closes the other half of the hole: `PendingApprovalInfo`
		// (sdk/packages/shared/src/hub.ts:892) carries no source/plugin field, so a
		// bare name on the auto list is auto-approved whoever contributed it. The
		// only available defence is keeping the list to names the monorepo actually
		// ships, so a plugin has to squat a real builtin name to reach it.
		const shipped = new Set(parseSdkDefaultToolNames());
		for (const name of AUTO_APPROVABLE_NAMES) {
			const resolved = SDK_TOOL_NAME_ALIASES[name] ?? name;
			expect(
				shipped.has(resolved),
				`${name} -> ${resolved} is not shipped`,
			).toBe(true);
			expect(SAFE_BUILTIN_TIERS[resolved]).toBeDefined();
		}
	});

	it("puts every auto-approvable name in its resolved builtin's tier", () => {
		for (const [name, tier] of CLASSIFICATION_TABLE) {
			if (tier === "execute") {
				continue;
			}
			const resolved = SDK_TOOL_NAME_ALIASES[name] ?? name;
			expect(classifyTool(name)).toBe(SAFE_BUILTIN_TIERS[resolved]);
		}
	});

	it("fails closed on names no first-party tool ships", () => {
		// `view`, `create`, `insert` and `str_replace` are `editor` *commands*, not
		// tool names: no `createTool({ name: … })` in the SDK uses them and they are
		// not alias keys. Only a plugin or MCP server could ever present one, so an
		// auto tier for them is an auto tier for an unknown third party.
		for (const name of ["view", "create", "insert", "str_replace"]) {
			expect(classifyTool(name)).toBe("execute");
		}
	});

	it("fails closed on a plugin-style tool squatting an unqualified safe name", () => {
		// Plugin tools keep their raw `tool.name`
		// (sdk/packages/core/src/services/plugin-tools.ts:217) and `createTool`
		// accepts any string, so these are indistinguishable from a builtin by name
		// alone. Anything the monorepo does not ship must land in `execute`.
		for (const name of ["read", "list", "grep", "glob", "view_file", "edit"]) {
			expect(classifyTool(name)).toBe("execute");
		}
	});
});

describe("classifyTool", () => {
	for (const [toolName, tier] of CLASSIFICATION_TABLE) {
		it(`classifies ${toolName} as ${tier}`, () => {
			expect(classifyTool(toolName)).toBe(tier);
		});
	}

	it("normalizes case and surrounding whitespace", () => {
		expect(classifyTool("  READ_FILE  ")).toBe("read");
		expect(classifyTool("Write_To_File")).toBe("write");
	});

	it("fails closed on a tool name nobody has ever heard of", () => {
		expect(classifyTool("frobnicate_the_widget")).toBe("execute");
	});

	it("fails closed on an empty or whitespace-only name", () => {
		expect(classifyTool("")).toBe("execute");
		expect(classifyTool("   ")).toBe("execute");
	});

	it("fails closed on namespaced tools even when the suffix looks safe", () => {
		expect(classifyTool("mcp__github__read_file")).toBe("execute");
		expect(classifyTool("mcp__read_file")).toBe("execute");
		expect(classifyTool("some-server:read_file")).toBe("execute");
		expect(classifyTool("server.read_file")).toBe("execute");
		expect(classifyTool("namespace/read_file")).toBe("execute");
	});

	it("fails closed on network + browser tools", () => {
		expect(classifyTool("web_fetch")).toBe("execute");
		expect(classifyTool("fetch_web_content")).toBe("execute");
		expect(classifyTool("browser_action")).toBe("execute");
	});
});

describe("DEFAULT_APPROVAL_POLICY", () => {
	it("auto-approves all three tiers by default", () => {
		expect(DEFAULT_APPROVAL_POLICY).toEqual({
			read: "auto",
			write: "auto",
			execute: "auto",
		});
	});

	it("covers every tier exactly once", () => {
		expect(APPROVAL_TIERS).toEqual(["read", "write", "execute"]);
		expect(Object.keys(DEFAULT_APPROVAL_POLICY).sort()).toEqual(
			[...APPROVAL_TIERS].sort(),
		);
	});
});

describe("shouldAutoApprove", () => {
	const allAsk: ApprovalPolicy = { read: "ask", write: "ask", execute: "ask" };
	const allAuto: ApprovalPolicy = {
		read: "auto",
		write: "auto",
		execute: "auto",
	};

	it("never auto-approves under an all-ask policy", () => {
		for (const [toolName] of CLASSIFICATION_TABLE) {
			expect(shouldAutoApprove(toolName, allAsk)).toBe(false);
		}
		expect(shouldAutoApprove("mystery_tool", allAsk)).toBe(false);
	});

	it("always auto-approves under an all-auto policy", () => {
		for (const [toolName] of CLASSIFICATION_TABLE) {
			expect(shouldAutoApprove(toolName, allAuto)).toBe(true);
		}
		// Unknown tools follow the execute tier.
		expect(shouldAutoApprove("mystery_tool", allAuto)).toBe(true);
	});

	it("honours a per-tier override without touching the other tiers", () => {
		const executeOnly: ApprovalPolicy = {
			read: "ask",
			write: "ask",
			execute: "auto",
		};
		expect(shouldAutoApprove("bash", executeOnly)).toBe(true);
		expect(shouldAutoApprove("read_file", executeOnly)).toBe(false);
		expect(shouldAutoApprove("write_to_file", executeOnly)).toBe(false);
	});
});
