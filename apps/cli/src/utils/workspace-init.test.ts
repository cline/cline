import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeWorkspace } from "./workspace-init";

describe("initializeWorkspace", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("creates .cline with workspace.json, rules, and skills", () => {
		const targetDir = mkdtempSync(join(tmpdir(), "cline-init-test-"));
		tempDirs.push(targetDir);

		const result = initializeWorkspace({ targetDir });

		expect(existsSync(result.clineDir)).toBe(true);
		expect(existsSync(result.workspaceJsonPath)).toBe(true);
		expect(existsSync(result.rulesPath)).toBe(true);
		expect(existsSync(result.skillsDir)).toBe(true);

		const config = JSON.parse(readFileSync(result.workspaceJsonPath, "utf8"));
		expect(config.name).toBeDefined();

		const rulesContent = readFileSync(result.rulesPath, "utf8");
		expect(rulesContent).toContain("# Project Rules");
	});

	it("preserves custom name in workspace.json", () => {
		const targetDir = mkdtempSync(join(tmpdir(), "cline-init-test-"));
		tempDirs.push(targetDir);

		const result = initializeWorkspace({ targetDir, name: "my-custom-app" });
		const config = JSON.parse(readFileSync(result.workspaceJsonPath, "utf8"));
		expect(config.name).toBe("my-custom-app");
	});

	it("does not overwrite existing workspace.json or rules", () => {
		const targetDir = mkdtempSync(join(tmpdir(), "cline-init-test-"));
		tempDirs.push(targetDir);

		initializeWorkspace({ targetDir, name: "first-name" });
		initializeWorkspace({ targetDir, name: "second-name" });

		const config = JSON.parse(
			readFileSync(join(targetDir, ".cline", "workspace.json"), "utf8"),
		);
		expect(config.name).toBe("first-name");
	});
});
