import type { Facts, FactsRead } from "../types";
import { errorCode, type RunCommand } from "./run";

export const GIT_PATHS_MAX = 8;

type GitStatus = {
	branch?: string;
	commit?: string;
	ahead?: number;
	behind?: number;
	dirty: string[];
};

/** `git status --porcelain=v2 --branch` output: branch, commit, divergence from upstream, and each changed path with its status. */
export function parseGitStatusV2(output: string): GitStatus {
	const status: GitStatus = { dirty: [] };
	for (const rawLine of output.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length).trim();
			if (head && head !== "(detached)") status.branch = head;
		} else if (line.startsWith("# branch.oid ")) {
			const oid = line.slice("# branch.oid ".length).trim();
			if (oid && oid !== "(initial)") status.commit = oid.slice(0, 9);
		} else if (line.startsWith("# branch.ab ")) {
			const ab = /\+(\d+) -(\d+)/.exec(line);
			if (ab) {
				status.ahead = Number(ab[1]);
				status.behind = Number(ab[2]);
			}
		} else if (!line.startsWith("#")) {
			const entry = changedPath(line);
			if (entry) status.dirty.push(entry);
		}
	}
	return status;
}

/** `1 XY … path`, `2 XY … path<TAB>origPath`, `u XY … path` and `? path`, as `XY path`. */
function changedPath(line: string): string | undefined {
	if (line.startsWith("? ")) return `?? ${line.slice(2)}`;
	const fields = line.split(" ");
	const marker = fields[0];
	const code = (fields[1] ?? "").replaceAll(".", "");
	const pathAt =
		marker === "1" ? 8 : marker === "2" ? 9 : marker === "u" ? 10 : -1;
	if (pathAt < 0) return undefined;
	const path = fields.slice(pathAt).join(" ").split("\t")[0];
	return path ? `${code || "?"} ${path}` : undefined;
}

function gitFacts(status: GitStatus): Facts {
	const lines: string[] = [];
	if (status.branch)
		lines.push(
			`Branch: ${status.branch}${status.commit ? ` (${status.commit})` : ""}`,
		);
	if (status.ahead || status.behind)
		lines.push(
			`Against upstream: ${status.ahead ?? 0} ahead, ${status.behind ?? 0} behind`,
		);
	lines.push(
		status.dirty.length === 0
			? "Working tree: clean"
			: `Working tree: ${status.dirty.length} changed file${status.dirty.length === 1 ? "" : "s"}`,
	);
	for (const entry of status.dirty.slice(0, GIT_PATHS_MAX))
		lines.push(`Changed: ${entry}`);
	if (status.dirty.length > GIT_PATHS_MAX)
		lines.push(`and ${status.dirty.length - GIT_PATHS_MAX} more changed files`);
	return { heading: "This folder's git state (after the turn)", lines };
}

/** Git exits 128 for any fatal error, so only this message means "no repository". */
function isNotARepository(error: unknown): boolean {
	const stderr =
		typeof error === "object" && error !== null && "stderr" in error
			? String(error.stderr)
			: "";
	return errorCode(error) === 128 && /not a git repository/i.test(stderr);
}

/**
 * One `git status` call, so the branch and the tree are as the turn left
 * them. A folder that is not a repository has no section; a read that fails
 * for any other reason is unknown, never "clean".
 */
export async function readGitFacts(
	run: RunCommand,
	cwd: string,
): Promise<FactsRead> {
	try {
		return gitFacts(
			parseGitStatusV2(
				await run(
					"git",
					["--no-optional-locks", "status", "--porcelain=v2", "--branch"],
					cwd,
				),
			),
		);
	} catch (error) {
		return isNotARepository(error) ? undefined : "unknown";
	}
}
