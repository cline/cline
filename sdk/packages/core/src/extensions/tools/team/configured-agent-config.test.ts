import { describe, expect, it } from "vitest";
import { parseConfiguredAgentConfig } from "./configured-agent-config";

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
