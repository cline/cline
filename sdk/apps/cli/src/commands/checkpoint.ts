import { execFile as execFileCallback } from "node:child_process";
import readline from "node:readline/promises";
import { promisify } from "node:util";
import type {
	CheckpointEntry,
	CheckpointMetadata,
	SessionRecord,
} from "@clinebot/core";
import { getLatestSessionRow, getSessionRow } from "../session/session";
import type { CliOutputMode } from "../utils/types";

const execFile = promisify(execFileCallback);

type CheckpointIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

type SessionRecordWithCheckpoint = SessionRecord & {
	metadata?: Record<string, unknown>;
};

function formatTimestamp(value: number): string {
	return new Date(value).toLocaleString();
}

function readCheckpointMetadata(
	session: SessionRecordWithCheckpoint | undefined,
): CheckpointMetadata | undefined {
	const raw = session?.metadata?.checkpoint;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return undefined;
	}
	const record = raw as Partial<CheckpointMetadata>;
	if (!record.latest || !Array.isArray(record.history)) {
		return undefined;
	}
	return {
		latest: record.latest as CheckpointEntry,
		history: record.history as CheckpointEntry[],
	};
}

function reportCheckpointAvailabilityIssue(
	message: string,
	outputMode: CliOutputMode,
	io: CheckpointIo,
): number {
	if (outputMode === "json") {
		io.writeErr(message);
		return 1;
	}
	io.writeln(message);
	return 0;
}

async function resolveSession(
	sessionId?: string,
): Promise<SessionRecordWithCheckpoint | undefined> {
	return sessionId
		? ((await getSessionRow(sessionId)) as
				| SessionRecordWithCheckpoint
				| undefined)
		: ((await getLatestSessionRow()) as
				| SessionRecordWithCheckpoint
				| undefined);
}

function checkpointsNewestFirst(
	metadata: CheckpointMetadata,
): CheckpointEntry[] {
	return [...metadata.history].reverse();
}

function selectCheckpoint(
	metadata: CheckpointMetadata,
	selector?: string,
): CheckpointEntry | undefined {
	if (!selector || selector === "latest") {
		return metadata.latest;
	}
	const index = Number.parseInt(selector, 10);
	if (!Number.isInteger(index) || index < 1) {
		return undefined;
	}
	return checkpointsNewestFirst(metadata)[index - 1];
}

async function promptForCheckpoint(
	metadata: CheckpointMetadata,
	io: CheckpointIo,
): Promise<CheckpointEntry | undefined> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return undefined;
	}
	const entries = checkpointsNewestFirst(metadata);
	io.writeln("Available checkpoints:");
	for (const [index, entry] of entries.entries()) {
		io.writeln(
			`${index + 1}. run ${entry.runCount}  ${formatTimestamp(entry.createdAt)}  ${entry.ref}`,
		);
	}
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		const answer = (
			await rl.question("Restore which checkpoint? [1-N, q]: ")
		).trim();
		if (!answer || answer.toLowerCase() === "q") {
			return undefined;
		}
		return selectCheckpoint(metadata, answer);
	} finally {
		rl.close();
	}
}

async function confirmRestore(entry: CheckpointEntry): Promise<boolean> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return false;
	}
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		const answer = (
			await rl.question(
				`Apply checkpoint ${entry.ref} to the current working tree? [y/N]: `,
			)
		)
			.trim()
			.toLowerCase();
		return answer === "y" || answer === "yes";
	} finally {
		rl.close();
	}
}

function printSummary(
	session: SessionRecordWithCheckpoint,
	metadata: CheckpointMetadata,
	outputMode: CliOutputMode,
	io: CheckpointIo,
): void {
	if (outputMode === "json") {
		process.stdout.write(
			JSON.stringify({
				sessionId: session.sessionId,
				latest: metadata.latest,
				count: metadata.history.length,
			}),
		);
		return;
	}
	io.writeln(`Session: ${session.sessionId}`);
	io.writeln(`Latest checkpoint: ${metadata.latest.ref}`);
	io.writeln(`Created: ${formatTimestamp(metadata.latest.createdAt)}`);
	io.writeln(`Run: ${metadata.latest.runCount}`);
	io.writeln(`History entries: ${metadata.history.length}`);
}

function printList(
	session: SessionRecordWithCheckpoint,
	metadata: CheckpointMetadata,
	outputMode: CliOutputMode,
	io: CheckpointIo,
): void {
	const entries = checkpointsNewestFirst(metadata).map((entry, index) => ({
		index: index + 1,
		...entry,
	}));
	if (outputMode === "json") {
		process.stdout.write(
			JSON.stringify({ sessionId: session.sessionId, checkpoints: entries }),
		);
		return;
	}
	io.writeln(`Session: ${session.sessionId}`);
	io.writeln("Checkpoint history:");
	for (const entry of entries) {
		io.writeln(
			`${entry.index}. run ${entry.runCount}  ${formatTimestamp(entry.createdAt)}  ${entry.ref}`,
		);
	}
}

export async function runCheckpointStatus(input: {
	sessionId?: string;
	outputMode: CliOutputMode;
	io: CheckpointIo;
}): Promise<number> {
	const session = await resolveSession(input.sessionId);
	if (!session) {
		return reportCheckpointAvailabilityIssue(
			"No matching session found",
			input.outputMode,
			input.io,
		);
	}
	const metadata = readCheckpointMetadata(session);
	if (!metadata) {
		return reportCheckpointAvailabilityIssue(
			`No checkpoint metadata found for session ${session.sessionId}`,
			input.outputMode,
			input.io,
		);
	}
	printSummary(session, metadata, input.outputMode, input.io);
	return 0;
}

export async function runCheckpointList(input: {
	sessionId?: string;
	outputMode: CliOutputMode;
	io: CheckpointIo;
}): Promise<number> {
	const session = await resolveSession(input.sessionId);
	if (!session) {
		input.io.writeln("No matching session found");
		return 0;
	}
	const metadata = readCheckpointMetadata(session);
	if (!metadata) {
		input.io.writeln(
			`No checkpoint metadata found for session ${session.sessionId}`,
		);
		return 0;
	}
	printList(session, metadata, input.outputMode, input.io);
	return 0;
}

export async function runCheckpointRestore(input: {
	sessionId?: string;
	selector?: string;
	yes?: boolean;
	outputMode: CliOutputMode;
	io: CheckpointIo;
}): Promise<number> {
	const session = await resolveSession(input.sessionId);
	if (!session) {
		input.io.writeErr("No matching session found");
		return 1;
	}
	const metadata = readCheckpointMetadata(session);
	if (!metadata) {
		input.io.writeln(
			`No checkpoint metadata found for session ${session.sessionId}`,
		);
		return 0;
	}

	let entry = selectCheckpoint(metadata, input.selector);
	if (!entry) {
		if (input.outputMode === "json") {
			input.io.writeln(
				"Checkpoint restore in json mode requires an explicit selector.",
			);
			return 0;
		}
		entry = await promptForCheckpoint(metadata, input.io);
		if (!entry) {
			input.io.writeln("Checkpoint restore cancelled.");
			return 0;
		}
	}

	if (!input.yes) {
		const confirmed = await confirmRestore(entry);
		if (!confirmed) {
			input.io.writeln("Checkpoint restore cancelled.");
			return 0;
		}
	}

	try {
		const repoCheck = await execFile(
			"git",
			["-C", session.cwd, "rev-parse", "--is-inside-work-tree"],
			{ windowsHide: true },
		);
		if (repoCheck.stdout.trim() !== "true") {
			input.io.writeErr(`${session.cwd} is not a git repository`);
			return 1;
		}
		await execFile("git", ["-C", session.cwd, "stash", "apply", entry.ref], {
			windowsHide: true,
		});
	} catch (error) {
		input.io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}

	if (input.outputMode === "json") {
		process.stdout.write(
			JSON.stringify({
				type: "checkpoint_restore",
				sessionId: session.sessionId,
				ref: entry.ref,
				runCount: entry.runCount,
				restored: true,
			}),
		);
		return 0;
	}

	input.io.writeln(`Restored checkpoint ${entry.ref}`);
	return 0;
}
