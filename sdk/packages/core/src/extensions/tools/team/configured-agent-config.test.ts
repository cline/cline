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
});
