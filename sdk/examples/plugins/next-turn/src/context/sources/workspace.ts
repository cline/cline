import type { RunCommand } from "../../run";
import type { ContextSource, SourceEnv } from "../source";

/** T0: the turn the hook was handed. Always present while Next is on. */
export const turnSource: ContextSource = {
	id: "turn",
	tier: "T0",
	probe: () => "present",
};

const REMOTE_HOSTS: ReadonlyArray<readonly [host: string, tag: string]> = [
	["github.com", "github"],
	["gitlab.com", "gitlab"],
	["bitbucket.org", "bitbucket"],
];

/** `remote:github` and the like, from the remote URLs; a host Next Turn does not know adds nothing. */
export function remoteTags(remotes: readonly string[]): string[] {
	const tags = new Set<string>();
	for (const remote of remotes) {
		const lower = remote.toLowerCase();
		for (const [host, tag] of REMOTE_HOSTS)
			if (lower.includes(host)) tags.add(`remote:${tag}`);
	}
	return [...tags].sort();
}

/**
 * T1: the folder's git state, from the session's `workspaceInfo`, so the
 * probe runs no git command. Absent when the folder is not a repository.
 */
export const gitSource: ContextSource = {
	id: "git",
	tier: "T1",
	displayName: "This folder's git state",
	probe: (env: SourceEnv) =>
		env.git && (env.git.branch || env.git.commit) ? "present" : "absent",
	capabilities: (env: SourceEnv) => remoteTags(env.git?.remotes ?? []),
};

type GitStatusSnapshot = {
	branch?: string;
	commit?: string;
	dirtyFiles: number;
};

/** Parse `git status --porcelain=v2 --branch` output into branch, commit oid and dirty-file count. */
export function parseGitStatusV2(output: string): GitStatusSnapshot {
	let branch: string | undefined;
	let commit: string | undefined;
	let dirtyFiles = 0;
	for (const rawLine of output.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length).trim();
			if (head && head !== "(detached)") branch = head;
		} else if (line.startsWith("# branch.oid ")) {
			const oid = line.slice("# branch.oid ".length).trim();
			if (oid && oid !== "(initial)") commit = oid;
		} else if (!line.startsWith("#")) {
			dirtyFiles += 1;
		}
	}
	return { branch, commit, dirtyFiles };
}

/**
 * Reads branch, commit oid and dirty-file count in one `git status --porcelain=v2 --branch`
 * call, handing the branch and commit to `onGit`. Undefined when git fails.
 */
export function dirtyFileCounter(
	run: RunCommand,
	onGit: (snapshot: GitStatusSnapshot) => void,
): (cwd: string) => Promise<number | undefined> {
	return async (cwd) => {
		try {
			const parsed = parseGitStatusV2(
				await run(
					"git",
					["--no-optional-locks", "status", "--porcelain=v2", "--branch"],
					cwd,
				),
			);
			onGit(parsed);
			return parsed.dirtyFiles;
		} catch {
			return undefined;
		}
	};
}
