import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_WORKSPACE_PROJECT_RULES,
	initializeWorkspaceLayout,
} from "./workspace-scaffold";

describe("initializeWorkspaceLayout", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function createRoot(): string {
		const dir = mkdtempSync(join(tmpdir(), "cline-workspace-scaffold-"));
		tempDirs.push(dir);
		return dir;
	}

	it("creates .cline/workspace.json, project rules, and the skills directory", () => {
		const root = createRoot();

		const result = initializeWorkspaceLayout({ targetDir: root });

		expect(result.clineDir).toBe(join(root, ".cline"));
		expect(existsSync(result.workspaceJsonPath)).toBe(true);
		expect(existsSync(result.rulesPath)).toBe(true);
		expect(existsSync(result.skillsDir)).toBe(true);
		expect(JSON.parse(readFileSync(result.workspaceJsonPath, "utf8"))).toEqual({
			name: basename(root),
		});
		expect(readFileSync(result.rulesPath, "utf8")).toBe(
			DEFAULT_WORKSPACE_PROJECT_RULES,
		);
	});

	it("uses an explicit workspace name, trimmed", () => {
		const root = createRoot();

		const result = initializeWorkspaceLayout({
			targetDir: root,
			name: "  my-monorepo  ",
		});

		expect(JSON.parse(readFileSync(result.workspaceJsonPath, "utf8"))).toEqual({
			name: "my-monorepo",
		});
	});

	it("treats a blank name as unset and falls back to the folder name", () => {
		const root = createRoot();

		const result = initializeWorkspaceLayout({ targetDir: root, name: "   " });

		expect(JSON.parse(readFileSync(result.workspaceJsonPath, "utf8"))).toEqual({
			name: basename(root),
		});
	});

	it("never clobbers existing user files", () => {
		const root = createRoot();
		const first = initializeWorkspaceLayout({ targetDir: root, name: "original" });
		writeFileSync(first.rulesPath, "# Hand written rules\n", "utf8");

		const second = initializeWorkspaceLayout({
			targetDir: root,
			name: "replacement",
		});

		expect(JSON.parse(readFileSync(second.workspaceJsonPath, "utf8"))).toEqual({
			name: "original",
		});
		expect(readFileSync(second.rulesPath, "utf8")).toBe("# Hand written rules\n");
	});
});