import type { HubCommandName, StatusUpdate } from "@cline/shared";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

/**
 * Bridges the browser Status Hub view to hub `status.*` commands.
 *
 * Paging is always server-side: the browser sends a cursor and a limit and
 * gets one page back, so a long changelog never has to be materialized in the
 * dashboard process or the tab.
 */

function asStatusUpdates(value: unknown): StatusUpdate[] {
	return Array.isArray(value) ? (value as StatusUpdate[]) : [];
}

export async function handleStatusCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: {
		type:
			| "status_query"
			| "status_board"
			| "status_current"
			| "status_subjects"
			| "status_summary";
		requestId: string;
		[key: string]: unknown;
	},
): Promise<void> {
	if (!ctx.uiClient) {
		ctx.send(peer, {
			type: "status_error",
			requestId: frame.requestId,
			text: "Hub is not connected.",
			code: "hub_disconnected",
		});
		return;
	}

	const command = frame.type.replace("status_", "status.") as HubCommandName;
	const { type: _type, requestId, ...payload } = frame;

	try {
		const reply = await ctx.uiClient.command(
			command,
			payload as Record<string, unknown>,
		);
		if (!reply.ok) {
			ctx.send(peer, {
				type: "status_error",
				requestId,
				text: reply.error?.message ?? "Status command failed.",
				code: reply.error?.code,
			});
			return;
		}

		if (frame.type === "status_summary") {
			ctx.send(peer, {
				type: "status_summary_result",
				requestId,
				summary: reply.payload?.summary as never,
			});
			return;
		}

		if (frame.type === "status_subjects") {
			ctx.send(peer, {
				type: "status_subjects_result",
				requestId,
				subjects: Array.isArray(reply.payload?.subjects)
					? (reply.payload.subjects as string[])
					: [],
			});
			return;
		}

		ctx.send(peer, {
			type: "status_page",
			requestId,
			updates: asStatusUpdates(reply.payload?.updates),
			nextCursor:
				typeof reply.payload?.nextCursor === "number"
					? reply.payload.nextCursor
					: null,
			hasMore: reply.payload?.hasMore === true,
			ftsAvailable: reply.payload?.ftsAvailable === true,
		});
	} catch (error) {
		ctx.send(peer, {
			type: "status_error",
			requestId,
			text: error instanceof Error ? error.message : String(error),
			code: "status_command_failed",
		});
	}
}
