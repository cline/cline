import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderListItem } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { assertLocalCliAvailable, withLocalCliStatus } from "./local-cli";

const originalPath = process.env.PATH;

afterEach(() => {
	process.env.PATH = originalPath;
});

/** PATH containing only the given stub executables. */
function stubPath(...commands: string[]): void {
	const binDir = mkdtempSync(join(tmpdir(), "cline-local-cli-"));
	for (const command of commands) {
		writeFileSync(join(binDir, command), "#!/bin/sh\nexit 0\n", {
			mode: 0o755,
		});
	}
	process.env.PATH = binDir;
}

function entry(id: string): ProviderListItem {
	return {
		id,
		name: id,
		models: 1,
		color: "#000",
		letter: "X",
		enabled: true,
		configured: true,
		authDescription: "",
		baseUrlDescription: "",
	};
}

describe("withLocalCliStatus", () => {
	it("withdraws configured from local-CLI entries whose CLI is missing", () => {
		stubPath("claude");
		const [claude, codex, anthropic] = withLocalCliStatus([
			entry("claude-code"),
			entry("openai-codex-cli"),
			entry("anthropic"),
		]);
		expect(claude).toMatchObject({
			configured: true,
			localCli: { command: "claude", installed: true },
		});
		expect(codex).toMatchObject({
			configured: false,
			localCli: {
				command: "codex",
				installed: false,
				docsUrl: "https://developers.openai.com/codex/cli",
			},
		});
		expect(anthropic).toEqual(entry("anthropic"));
	});
});

describe("assertLocalCliAvailable", () => {
	it("throws an actionable error naming the CLI and its docs", () => {
		stubPath();
		expect(() => assertLocalCliAvailable("opencode")).toThrow(
			"OpenCode signs in through the `opencode` CLI, which was not found on PATH. " +
				"Install it and run `opencode` once to sign in: https://opencode.ai/docs",
		);
	});

	it("passes when the CLI is installed or the provider needs none", () => {
		stubPath("codex");
		expect(() => assertLocalCliAvailable("openai-codex-cli")).not.toThrow();
		expect(() => assertLocalCliAvailable("openrouter")).not.toThrow();
	});
});
