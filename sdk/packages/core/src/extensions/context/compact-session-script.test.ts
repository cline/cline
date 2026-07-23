import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT_PATH = fileURLToPath(
	new URL("../../../scripts/compact-session.ts", import.meta.url),
);
const FIXTURE_DIRECTORY = fileURLToPath(
	new URL("../../../fixtures/session", import.meta.url),
);

function runScript(strategy: "agentic" | "basic") {
	return spawnSync(
		"bun",
		[
			"--conditions=development",
			"run",
			SCRIPT_PATH,
			FIXTURE_DIRECTORY,
			"--strategy",
			strategy,
			"--provider",
			"anthropic",
			"--model",
			"claude-sonnet-4-6",
		],
		{
			encoding: "utf8",
			env: { ...process.env, ANTHROPIC_API_KEY: "" },
		},
	);
}

describe("test:compaction script", () => {
	it("allows provider metadata for basic compaction without an API key", () => {
		const result = runScript("basic");

		expect(result.status, result.stderr).toBe(0);
		expect(result.stderr).toContain("Running basic compaction");
		expect(result.stderr).not.toContain("Missing API key");
	});

	it("still requires an API key for agentic compaction", () => {
		const result = runScript("agentic");

		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("Missing API key in ANTHROPIC_API_KEY");
	});
});
