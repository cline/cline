import { describe, expect, it } from "vitest";
import {
	parseConfiguredAgentConfig,
	resolveConfiguredAgentAllowedToolNames,
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

	it("parses plugins entries as bare names and install mappings", () => {
		const config = parseConfiguredAgentConfig(`---
name: code-reviewer
description: Reviews code
plugins:
  - branch-protector
  - name: clickhouse-data-analyst
    install: clickhouse-data-analyst
  - name: my-tool
    install: https://github.com/someone/repo/blob/main/plugin.ts
---
You are a code reviewer.`);

		expect(config.plugins).toEqual([
			{ name: "branch-protector" },
			{ name: "clickhouse-data-analyst", install: "clickhouse-data-analyst" },
			{
				name: "my-tool",
				install: "https://github.com/someone/repo/blob/main/plugin.ts",
			},
		]);
	});

	it("parses plugins from a comma-separated string and dedupes by name", () => {
		const config = parseConfiguredAgentConfig(`---
name: code-reviewer
description: Reviews code
plugins: branch-protector, Branch-Protector, , other-tool
---
You are a code reviewer.`);

		expect(config.plugins).toEqual([
			{ name: "branch-protector" },
			{ name: "other-tool" },
		]);
	});

	it("distinguishes an absent plugins field from an empty one", () => {
		const absent = parseConfiguredAgentConfig(`---
name: code-reviewer
description: Reviews code
---
You are a code reviewer.`);
		expect(absent.plugins).toBeUndefined();

		const empty = parseConfiguredAgentConfig(`---
name: code-reviewer
description: Reviews code
plugins: []
---
You are a code reviewer.`);
		expect(empty.plugins).toEqual([]);
	});

	it("rejects plugin mappings without a name", () => {
		expect(() =>
			parseConfiguredAgentConfig(`---
name: code-reviewer
description: Reviews code
plugins:
  - install: https://example.com/plugin.ts
---
You are a code reviewer.`),
		).toThrow();
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

describe("resolveConfiguredAgentAllowedToolNames", () => {
	it("returns undefined when the config does not restrict tools", () => {
		expect(
			resolveConfiguredAgentAllowedToolNames({ skills: ["review-pr"] }),
		).toBeUndefined();
	});

	it("resolves legacy aliases and normalizes casing", () => {
		expect(
			resolveConfiguredAgentAllowedToolNames({
				tools: ["Execute_Command", "read_file", "editor"],
			}),
		).toEqual(new Set(["run_commands", "read_files", "editor"]));
	});

	it("implicitly allows the skills tool when skills are configured", () => {
		expect(
			resolveConfiguredAgentAllowedToolNames({
				tools: ["read_files"],
				skills: ["review-pr"],
			}),
		).toEqual(new Set(["read_files", "skills"]));
	});

	it("treats an empty tools list as allowing nothing extra", () => {
		expect(resolveConfiguredAgentAllowedToolNames({ tools: [] })).toEqual(
			new Set(),
		);
	});
});
