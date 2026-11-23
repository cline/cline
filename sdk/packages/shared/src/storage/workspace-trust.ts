import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { resolveClineDataDir, resolveClineDir } from "./paths";

/**
 * Folders the user has agreed to let Cline work in. A workspace can carry
 * rules, skills, hooks, and plugins that Cline picks up automatically, so each
 * client asks before starting in a folder that is not listed here. The list is
 * shared by the CLI, the desktop app, and the VS Code extension.
 */
export function resolveTrustedWorkspacesPath(): string {
	return join(resolveClineDataDir(), "settings", "trusted-workspaces.json");
}

function normalize(path: string): string {
	const resolved = resolve(path);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function readTrustedWorkspaces(): string[] {
	try {
		const parsed = JSON.parse(
			readFileSync(resolveTrustedWorkspacesPath(), "utf8"),
		);
		const entries = parsed?.trustedWorkspaces;
		return Array.isArray(entries)
			? entries.filter((entry) => typeof entry === "string")
			: [];
	} catch {
		return [];
	}
}

/**
 * True when the folder, or a folder containing it, is on the allow list.
 * Cline's own directories (the no-project chat workspace, task worktrees cut
 * from an already trusted repo) never need a prompt.
 */
export function isWorkspaceTrusted(workspacePath: string): boolean {
	const target = normalize(workspacePath);
	return [resolveClineDir(), resolveClineDataDir(), ...readTrustedWorkspaces()]
		.map(normalize)
		.some(
			(root) =>
				target === root ||
				target.startsWith(root.endsWith(sep) ? root : root + sep),
		);
}

export function trustWorkspace(workspacePath: string): void {
	if (isWorkspaceTrusted(workspacePath)) {
		return;
	}
	const filePath = resolveTrustedWorkspacesPath();
	const tempPath = `${filePath}.${process.pid}.tmp`;
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(
		tempPath,
		`${JSON.stringify(
			{
				trustedWorkspaces: [...readTrustedWorkspaces(), resolve(workspacePath)],
			},
			null,
			2,
		)}\n`,
	);
	renameSync(tempPath, filePath);
}
