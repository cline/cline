import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SessionHistoryRecord } from "@clinebot/core";
import { generateConversationHTML } from "../session/export";
import {
	deleteSession,
	listSessions,
	readSessionMessagesArtifact,
	updateSession,
} from "../session/session";
import { writeln } from "../utils/output";
import type { CliOutputMode } from "../utils/types";

// Re-export formatting helpers from the extracted TUI component so existing
// consumers (tests, other modules) continue to work without changing imports.
export {
	formatCheckpointDetail,
	formatHistoryListLine,
} from "../tui/components/HistoryListView";

type HistoryIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

async function exportHistorySession(
	sessionId: string,
	outputPath?: string,
): Promise<string> {
	const data = await readSessionMessagesArtifact(sessionId);
	if (!data) {
		throw new Error(`Session ${sessionId} not found or has no messages.json`);
	}

	const targetPath = resolve(outputPath?.trim() || `${sessionId}.html`);
	const html = generateConversationHTML(data, sessionId);
	await mkdir(dirname(targetPath), { recursive: true });
	await writeFile(targetPath, html, "utf8");
	return targetPath;
}

async function runHistoryDelete(
	sessionId: string | undefined,
	outputMode: CliOutputMode,
	io: HistoryIo,
): Promise<number> {
	if (!sessionId) {
		io.writeErr("history delete requires --session-id <id>");
		return 1;
	}

	try {
		const result = await deleteSession(sessionId);
		if (outputMode === "json") {
			process.stdout.write(JSON.stringify(result));
			return result.deleted ? 0 : 1;
		}
		if (result.deleted) {
			io.writeln(`Deleted session ${sessionId}`);
			return 0;
		}
		io.writeErr(`Session ${sessionId} not found`);
		return 1;
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

async function runHistoryUpdate(
	sessionId: string | undefined,
	prompt: string | undefined,
	title: string | undefined,
	metadataStr: string | undefined,
	outputMode: CliOutputMode,
	io: HistoryIo,
): Promise<number> {
	if (!sessionId) {
		io.writeErr("history update requires --session-id <id>");
		return 1;
	}

	let metadata: Record<string, unknown> | undefined;
	if (metadataStr) {
		try {
			metadata = JSON.parse(metadataStr);
		} catch (error) {
			io.writeErr(
				`Invalid metadata JSON: ${error instanceof Error ? error.message : String(error)}`,
			);
			return 1;
		}
	}
	if (title !== undefined) {
		if (metadata) {
			delete metadata.title;
		}
	}
	if (metadata && Object.keys(metadata).length === 0) {
		metadata = undefined;
	}

	if (prompt === undefined && metadata === undefined && title === undefined) {
		io.writeErr(
			"history update requires --prompt <text>, --title <text>, or --metadata <json>",
		);
		return 1;
	}

	try {
		const result = await updateSession(sessionId, { prompt, metadata, title });
		if (outputMode === "json") {
			process.stdout.write(JSON.stringify(result));
			return result.updated ? 0 : 1;
		}
		if (result.updated) {
			io.writeln(`Updated session ${sessionId}`);
			return 0;
		}
		io.writeErr(`Session ${sessionId} not found`);
		return 1;
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

async function runHistoryExport(
	sessionId: string | undefined,
	outputPath: string | undefined,
	outputMode: CliOutputMode,
	io: HistoryIo,
): Promise<number> {
	if (!sessionId) {
		io.writeErr("history export requires <session-id>");
		return 1;
	}

	try {
		const targetPath = await exportHistorySession(sessionId, outputPath);

		if (outputMode === "json") {
			process.stdout.write(
				JSON.stringify({
					sessionId,
					outputPath: targetPath,
				}),
			);
			return 0;
		}

		io.writeln(`Exported to ${targetPath}`);
		return 0;
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

export async function runHistoryList(input: {
	limit: number;
	outputMode: CliOutputMode;
	workspaceRoot?: string;
	io?: HistoryIo;
}): Promise<number | string> {
	const io = input.io ?? {
		writeln,
		writeErr: (text: string) => process.stderr.write(`${text}\n`),
	};
	const limit = Number.isFinite(input.limit) ? input.limit : 200;

	const hydratedRows = await listSessions(limit, {
		workspaceRoot: input.workspaceRoot,
	});
	if (hydratedRows.length === 0) {
		if (input.outputMode === "json") {
			process.stdout.write(JSON.stringify([]));
		} else {
			io.writeln("No history found.");
		}
		return 0;
	}

	if (input.outputMode === "json") {
		process.stdout.write(JSON.stringify(hydratedRows));
		return 0;
	}

	// Lazy-import the TUI component to avoid pulling in React/ink for
	// non-interactive (JSON) code paths.
	const { render } = await import("ink");
	const React = (await import("react")).default;
	const { HistoryListView } = await import("../tui/components/HistoryListView");

	// Interactive selection mode
	return new Promise((resolve) => {
		const { unmount } = render(
			React.createElement(HistoryListView, {
				rows: hydratedRows as SessionHistoryRecord[],
				onSelect: (sessionId) => {
					unmount();
					resolve(sessionId);
				},
				onExport: async (sessionId) =>
					await exportHistorySession(sessionId, undefined),
				onExit: () => {
					unmount();
					resolve(0);
				},
			}),
		);
	});
}

export {
	exportHistorySession,
	runHistoryDelete,
	runHistoryExport,
	runHistoryUpdate,
};
