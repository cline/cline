import type { SessionHistoryRecord } from "@clinebot/core";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React from "react";
import { deleteSession } from "../session/session";
import { HistoryStandaloneContent } from "./views/history-view";

export async function renderHistoryStandalone(input: {
	rows: SessionHistoryRecord[];
	onExport: (sessionId: string) => Promise<string | undefined>;
}): Promise<number | string> {
	const renderer = await createCliRenderer({
		exitOnCtrlC: true,
		autoFocus: false,
		enableMouseMovement: true,
	});

	return new Promise((resolve) => {
		let settled = false;
		let unmounted = false;
		const root = createRoot(renderer);

		const unmountRoot = () => {
			if (unmounted) {
				return;
			}
			unmounted = true;
			root.unmount();
		};

		const settle = (value: number | string) => {
			if (settled) {
				return;
			}
			settled = true;
			unmountRoot();
			renderer.destroy();
			resolve(value);
		};

		renderer.on("destroy", () => {
			unmountRoot();
			if (!settled) {
				settled = true;
				resolve(0);
			}
		});

		root.render(
			React.createElement(HistoryStandaloneContent, {
				rows: input.rows,
				onResolve: (sessionId: string) => settle(sessionId),
				onExport: input.onExport,
				onDelete: async (sessionId: string) => {
					const result = await deleteSession(sessionId);
					return result.deleted;
				},
				onDismiss: () => settle(0),
			}),
		);
	});
}
