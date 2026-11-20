import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	loadConfiguredAgentConfigs,
	parseConfiguredAgentConfig,
} from "./configured-agent-config";

describe("configured agent config parser", () => {
	it("parses YAML frontmatter and system prompt body", () => {
		const config = parseConfiguredAgentConfig(`---
name: code-reviewer
description: Reviews code
tools: execute_command, read_file
skills:
  - review-pr
modelId: anthropic/claude-sonnet-4.6
---
You are a code reviewer.`);

		expect(config).toMatchObject({
			name: "code-reviewer",
			description: "Reviews code",
			tools: ["execute_command", "read_file"],
			skills: ["review-pr"],
			modelId: "anthropic/claude-sonnet-4.6",
			systemPrompt: "You are a code reviewer.",
		});
	});

	// Regression test for https://github.com/cline/cline/issues/12151: a leading UTF-8 BOM
	// (e.g. saved by Windows Notepad's "UTF-8 with BOM" encoding) must not prevent frontmatter
	// from being recognized.
	it("parses frontmatter when the content starts with a UTF-8 BOM", () => {
		const config = parseConfiguredAgentConfig(`\uFEFF---
name: code-reviewer
description: Reviews code
---
You are a code reviewer.`);

		expect(config).toMatchObject({
			name: "code-reviewer",
			description: "Reviews code",
			systemPrompt: "You are a code reviewer.",
		});
	});

	it("does not treat delimiter lines in the body as frontmatter delimiters", () => {
		const config = parseConfiguredAgentConfig(`---
name: code-reviewer
description: Reviews code
tools: read_file
---
Prompt body
---
More prompt`);

		expect(config.systemPrompt).toBe("Prompt body\n---\nMore prompt");
	});

	// Regression test for https://github.com/cline/cline/issues/15556: agent configs are
	// commonly saved as Markdown (YAML frontmatter plus a prompt body), and the scan used to
	// drop anything whose extension was not .yml/.yaml before the file was ever opened.
	it("loads agent configs saved with a .md extension", () => {
		const directory = mkdtempSync(join(tmpdir(), "cline-agent-config-"));
		try {
			writeFileSync(
				join(directory, "probe.md"),
				`---
name: probe
description: Probe agent.
---
You are a probe.`,
			);

			const { configs, errors } = loadConfiguredAgentConfigs({
				searchPaths: [directory],
			});

			expect(errors).toEqual([]);
			expect(configs).toHaveLength(1);
			expect(configs[0]).toMatchObject({
				name: "probe",
				description: "Probe agent.",
				systemPrompt: "You are a probe.",
			});
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.each([
		["empty", ""],
		["comment-only", "# comment"],
		["scalar", "code-reviewer"],
	])("rejects %s frontmatter candidates without hanging", (_name, yaml) => {
		expect(() =>
			parseConfiguredAgentConfig(`---
${yaml}
---
You are a code reviewer.`),
		).toThrow("Missing closing YAML frontmatter delimiter");
	});
});
