// RFC 0001 (hierarchical workspaces) — shared `.cline/` scaffolder.
//
// Both the CLI (apps/cli, Phase 4) and the VS Code extension (apps/vscode,
// Phase 5) used to ship a copy of this layout writer. It now lives once in
// @cline/shared/storage so the two hosts can never drift; each host keeps a thin
// re-export module under its historical name.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { WORKSPACE_CONFIG_FILE_NAME } from "./workspace-schema";

export interface InitializeWorkspaceLayoutOptions {
	/** Directory that receives `.cline/` (the workspace root, not a subfolder). */
	targetDir: string;
	/** Workspace label written to `workspace.json`; defaults to the folder name. */
	name?: string;
}

export interface InitializeWorkspaceLayoutResult {
	clineDir: string;
	workspaceJsonPath: string;
	rulesPath: string;
	skillsDir: string;
}

export const DEFAULT_WORKSPACE_PROJECT_RULES = `# Project Rules

Add project-specific instructions, conventions, and guidelines for Cline here.
`;

/**
 * Idempotently scaffold `.cline/workspace.json`, `.cline/rules/project-rules.md`,
 * and `.cline/skills/`. Existing files are left untouched so re-running from an
 * onboarding surface can never clobber user edits.
 */
export function initializeWorkspaceLayout(
	options: InitializeWorkspaceLayoutOptions,
): InitializeWorkspaceLayoutResult {
	const targetDir = options.targetDir;
	const workspaceName = options.name?.trim() || basename(targetDir);
	const clineDir = join(targetDir, ".cline");
	const rulesDir = join(clineDir, "rules");
	const skillsDir = join(clineDir, "skills");
	const workspaceJsonPath = join(clineDir, WORKSPACE_CONFIG_FILE_NAME);
	const rulesPath = join(rulesDir, "project-rules.md");

	mkdirSync(clineDir, { recursive: true });
	mkdirSync(rulesDir, { recursive: true });
	mkdirSync(skillsDir, { recursive: true });

	if (!existsSync(workspaceJsonPath)) {
		writeFileSync(
			workspaceJsonPath,
			`${JSON.stringify({ name: workspaceName }, null, 2)}\n`,
			"utf8",
		);
	}
	if (!existsSync(rulesPath)) {
		writeFileSync(rulesPath, DEFAULT_WORKSPACE_PROJECT_RULES, "utf8");
	}

	return { clineDir, workspaceJsonPath, rulesPath, skillsDir };
}