import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { WORKSPACE_CONFIG_FILE_NAME } from "@cline/shared/storage";

export interface InitializeWorkspaceOptions {
	targetDir: string;
	name?: string;
}

export interface InitializedWorkspaceResult {
	clineDir: string;
	workspaceJsonPath: string;
	rulesPath: string;
	skillsDir: string;
}

const DEFAULT_PROJECT_RULES = `# Project Rules

Add project-specific instructions, conventions, and guidelines for Cline here.
`;

/**
 * Initialize a Cline workspace (.cline/) with workspace.json,
 * rules/project-rules.md, and skills/ directory.
 * Conforms to RFC 0001 Section 2.1 & 2.2.
 */
export function initializeWorkspace(
	options: InitializeWorkspaceOptions,
): InitializedWorkspaceResult {
	const targetDir = options.targetDir;
	const folderName = options.name || basename(targetDir);
	const clineDir = join(targetDir, ".cline");
	const rulesDir = join(clineDir, "rules");
	const skillsDir = join(clineDir, "skills");
	const workspaceJsonPath = join(clineDir, WORKSPACE_CONFIG_FILE_NAME);
	const rulesPath = join(rulesDir, "project-rules.md");

	mkdirSync(clineDir, { recursive: true });
	mkdirSync(rulesDir, { recursive: true });
	mkdirSync(skillsDir, { recursive: true });

	if (!existsSync(workspaceJsonPath)) {
		const config = {
			name: folderName,
		};
		writeFileSync(
			workspaceJsonPath,
			`${JSON.stringify(config, null, 2)}\n`,
			"utf8",
		);
	}

	if (!existsSync(rulesPath)) {
		writeFileSync(rulesPath, DEFAULT_PROJECT_RULES, "utf8");
	}

	return {
		clineDir,
		workspaceJsonPath,
		rulesPath,
		skillsDir,
	};
}
