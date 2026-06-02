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

export async function readRepoStatus(cwd: string): Promise<RepoStatus> {
	const [branchResult, diffResult] = await Promise.allSettled([
		execFileAsync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
			encoding: "utf8",
		}),
		execFileAsync("git", ["-C", cwd, "diff", "--shortstat"], {
			encoding: "utf8",
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
