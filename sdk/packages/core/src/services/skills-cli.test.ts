import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SKILLS_CLI_PACKAGE, SKILLS_CLI_VERSION } from "./skills-cli";

describe("skills CLI pin", () => {
	// The call-site tests compare against the constant itself, so this is the
	// one place that checks what the constant promises: the exact release that
	// package.json declares, not a tag or a range.
	it("is the exact release declared in core's package.json", () => {
		const packageJson = JSON.parse(
			readFileSync(
				fileURLToPath(new URL("../../package.json", import.meta.url)),
				"utf8",
			),
		) as { devDependencies?: Record<string, string> };
		const declared = packageJson.devDependencies?.skills;

		expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
		expect(SKILLS_CLI_VERSION).toBe(declared);
		expect(SKILLS_CLI_PACKAGE).toBe(`skills@${declared}`);
	});
});
