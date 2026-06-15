import type { SessionHistoryRecord } from "@cline/core";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React from "react";
import { deleteSession } from "../session/session";
import { HistoryStandaloneContent } from "./views/history-view";

export async function renderHistoryStandalone(input: {
	rows: SessionHistoryRecord[];
	onExport: (sessionId: string) => Promise<string | undefined>;
	refreshRows?: () => Promise<SessionHistoryRecord[]>;
}): Promise<number | string> {
	const renderer = await createCliRenderer({
		exitOnCtrlC: true,
		autoFocus: false,
		enableMouseMovement: true,
	});

	return new Promise((resolve) => {
		let result: number | string = 0;
		let resolved = false;
		let destroyStarted = false;
		let unmounted = false;
		const root = createRoot(renderer);

		const unmountRoot = () => {
			if (unmounted) {
				return;
			}
			unmounted = true;
			root.unmount();
		};

		// Resolve only once teardown has finished, so callers never run while
		// the renderer is still restoring the terminal.
		renderer.on("destroy", () => {
			unmountRoot();
			if (!resolved) {
				resolved = true;
				resolve(result);
			}
		});

		const settle = (value: number | string) => {
			if (destroyStarted) {
				return;
			}
			destroyStarted = true;
			result = value;
			unmountRoot();
			// Let OpenTUI finish parsing the current stdin batch before teardown.
			queueMicrotask(() => {
				renderer.destroy();
			});
		};

		root.render(
			React.createElement(HistoryStandaloneContent, {
				rows: input.rows,
				onResolve: (sessionId: string) => settle(sessionId),
				onExport: input.onExport,
				refreshRows: input.refreshRows,
				onDelete: async (sessionId: string) => {
					const result = await deleteSession(sessionId);
					return result.deleted;
				},
				onDismiss: () => settle(0),
			}),
		);
	});
}
