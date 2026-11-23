import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitDiffStats = {
	files: number;
	additions: number;
	deletions: number;
};

export interface RepoStatus {
	branch: string | null;
	diffStats: GitDiffStats | null;
}

export function isSameRepoStatus(a: RepoStatus, b: RepoStatus): boolean {
	if (a.branch !== b.branch) return false;
	if (a.diffStats === null || b.diffStats === null) {
		return a.diffStats === b.diffStats;
	}
	return (
		a.diffStats.files === b.diffStats.files &&
		a.diffStats.additions === b.diffStats.additions &&
		a.diffStats.deletions === b.diffStats.deletions
	);
}

export async function readRepoStatus(cwd: string): Promise<RepoStatus> {
	const [branchResult, diffResult] = await Promise.allSettled([
		execFileAsync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
			encoding: "utf8",
			// Prevent a console window from flashing on Windows.
			windowsHide: true,
		}),
		execFileAsync("git", ["-C", cwd, "diff", "--shortstat"], {
			encoding: "utf8",
			windowsHide: true,
		}),
	]);

	const branch =
		branchResult.status === "fulfilled"
			? branchResult.value.stdout.trim() || null
			: null;

	let diffStats: GitDiffStats | null = null;
	if (diffResult.status === "fulfilled") {
		const output = diffResult.value.stdout.trim();
		if (output) {
			const filesMatch = output.match(/(\d+)\s+file/);
			const additionsMatch = output.match(/(\d+)\s+insertion/);
			const deletionsMatch = output.match(/(\d+)\s+deletion/);
			diffStats = {
				files: filesMatch ? Number.parseInt(filesMatch[1] ?? "0", 10) : 0,
				additions: additionsMatch
					? Number.parseInt(additionsMatch[1] ?? "0", 10)
					: 0,
				deletions: deletionsMatch
					? Number.parseInt(deletionsMatch[1] ?? "0", 10)
					: 0,
			};
		}
	}

	return { branch, diffStats };
}

export async function readGitOriginUrl(
	cwd: string,
): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["-C", cwd, "remote", "get-url", "origin"],
			{ encoding: "utf8", windowsHide: true },
		);
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

/** "owner/name" for GitHub remotes in https, ssh, or scp-like form. */
export function parseGitHubRepoFullName(
	remoteUrl: string | undefined,
): string | undefined {
	const match = remoteUrl
		?.trim()
		.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
	return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}
