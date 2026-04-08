import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { AgentHooks, BasicLogger } from "@clinebot/shared";

const execFile = promisify(execFileCallback);

export interface CheckpointEntry {
	ref: string;
	createdAt: number;
	runCount: number;
	kind?: "stash" | "commit";
}

export interface CheckpointMetadata {
	latest: CheckpointEntry;
	history: CheckpointEntry[];
}

type CreateCheckpointHooksOptions = {
	cwd: string;
	sessionId: string;
	logger?: BasicLogger;
	readSessionMetadata: () => Promise<Record<string, unknown> | undefined>;
	writeSessionMetadata: (
		metadata: Record<string, unknown>,
	) => Promise<void> | void;
};

function warn(logger: BasicLogger | undefined, message: string): void {
	logger?.warn?.(message);
}

function readCheckpointMetadata(
	metadata: Record<string, unknown> | undefined,
): CheckpointMetadata | undefined {
	const candidate = metadata?.checkpoint;
	if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
		return undefined;
	}
	const record = candidate as Partial<CheckpointMetadata>;
	if (!record.latest || !Array.isArray(record.history)) {
		return undefined;
	}
	const latest = record.latest as Partial<CheckpointEntry>;
	const history = record.history.filter(
		(entry): entry is CheckpointEntry =>
			!!entry &&
			typeof entry === "object" &&
			typeof (entry as Partial<CheckpointEntry>).ref === "string" &&
			typeof (entry as Partial<CheckpointEntry>).createdAt === "number" &&
			typeof (entry as Partial<CheckpointEntry>).runCount === "number",
	);
	if (
		typeof latest.ref !== "string" ||
		typeof latest.createdAt !== "number" ||
		typeof latest.runCount !== "number"
	) {
		return undefined;
	}
	return {
		latest: latest as CheckpointEntry,
		history,
	};
}

async function runGit(
	cwd: string,
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	const result = await execFile("git", ["-C", cwd, ...args], {
		windowsHide: true,
	});
	return {
		stdout: result.stdout.trim(),
		stderr: result.stderr.trim(),
	};
}

export function createCheckpointHooks(
	options: CreateCheckpointHooksOptions,
): AgentHooks {
	let runCount = 0;
	let repoSupported: boolean | undefined;

	const ensureGitRepository = async (): Promise<boolean> => {
		if (repoSupported !== undefined) {
			return repoSupported;
		}
		try {
			const result = await runGit(options.cwd, [
				"rev-parse",
				"--is-inside-work-tree",
			]);
			repoSupported = result.stdout === "true";
		} catch {
			repoSupported = false;
		}
		return repoSupported;
	};

	const createCheckpoint = async (): Promise<CheckpointEntry | undefined> => {
		if (!(await ensureGitRepository())) {
			return undefined;
		}

		const message = `cline checkpoint session=${options.sessionId} run=${runCount}`;
		let ref = "";
		try {
			const result = await runGit(options.cwd, ["stash", "create", message]);
			ref = result.stdout.trim();
		} catch (error) {
			warn(
				options.logger,
				`Checkpoint snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
		}
		if (!ref) {
			try {
				const result = await runGit(options.cwd, ["rev-parse", "HEAD"]);
				ref = result.stdout.trim();
			} catch (error) {
				warn(
					options.logger,
					`Checkpoint HEAD fallback failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				return undefined;
			}
			if (!ref) {
				return undefined;
			}
			return {
				ref,
				createdAt: Date.now(),
				runCount,
				kind: "commit",
			};
		}

		try {
			await runGit(options.cwd, ["stash", "store", "-m", message, ref]);
		} catch (error) {
			warn(
				options.logger,
				`Checkpoint store failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
		}

		return {
			ref,
			createdAt: Date.now(),
			runCount,
			kind: "stash",
		};
	};

	return {
		onRunStart: async ({ parentAgentId }) => {
			if (parentAgentId === null) {
				runCount += 1;
			}
			return undefined;
		},
		onBeforeAgentStart: async ({ parentAgentId, iteration }) => {
			if (parentAgentId !== null || iteration !== 1 || runCount < 1) {
				return undefined;
			}
			const entry = await createCheckpoint();
			if (!entry) {
				return undefined;
			}
			const metadata = await options.readSessionMetadata();
			const existing = readCheckpointMetadata(metadata);
			const history = [...(existing?.history ?? []), entry];
			await options.writeSessionMetadata({
				...(metadata ?? {}),
				checkpoint: {
					latest: entry,
					history,
				} satisfies CheckpointMetadata,
			});
			return undefined;
		},
	};
}
