import { rmSync } from "node:fs";
import {
	type ClineCore,
	getProcessStartToken,
	probeProcessStartTokenAsync,
	SqliteSessionStore,
} from "@cline/core";
import {
	readSideConversation,
	type SideConversation,
} from "../../shared/side-conversation";
import { sessionLogPath } from "../paths";
import { LOCAL_ENVIRONMENT_ID, type SidecarContext } from "../types";

export function sideConversationOwner(ctx: SidecarContext) {
	return {
		runId: ctx.bootId,
		pid: process.pid,
		startToken: getProcessStartToken(process.pid) ?? null,
	};
}

export function isTemporarySideClosed(ctx: SidecarContext, sessionId: string) {
	return (
		(ctx.activeEnvironmentId ?? LOCAL_ENVIRONMENT_ID) ===
			LOCAL_ENVIRONMENT_ID &&
		ctx.temporarySideConversations.closed.has(sessionId)
	);
}

export function assertSideConversationAvailable(
	ctx: SidecarContext,
	sessionId: string,
	metadata?: unknown,
) {
	const state = ctx.temporarySideConversations;
	const side = readSideConversation(metadata);
	if (
		(side && state.closing) ||
		isTemporarySideClosed(ctx, sessionId) ||
		(side && side.owner?.runId !== ctx.bootId)
	) {
		throw new Error(
			"This temporary side chat has ended. Open a new side chat from the main conversation.",
		);
	}
}

export function listTemporarySideConversations() {
	const store = new SqliteSessionStore();
	try {
		return store
			.queryAll<{ session_id: string }>(
				`SELECT session_id FROM sessions WHERE CASE WHEN json_valid(metadata_json)
			 THEN json_extract(metadata_json, '$.desktopSideConversation.owner.runId') END IS NOT NULL`,
			)
			.flatMap(({ session_id: sessionId }) => {
				const side = readSideConversation(store.get(sessionId)?.metadata);
				return side?.owner ? [{ sessionId, side }] : [];
			});
	} finally {
		store.close();
	}
}

async function isSideConversationOwnerDead(
	owner: NonNullable<SideConversation["owner"]>,
) {
	const probe = await probeProcessStartTokenAsync(owner.pid);
	return (
		probe.status === "missing" ||
		(probe.status === "found" &&
			owner.startToken !== null &&
			probe.token !== owner.startToken)
	);
}

export async function deleteTemporarySideConversation(
	manager: Pick<ClineCore, "delete">,
	sessionId: string,
) {
	// The normal delete path stops the runtime, clears its queue and evicts search data.
	await manager.delete(sessionId);
	rmSync(sessionLogPath(sessionId), { force: true, recursive: true });
}

export async function cleanupStaleSideConversations(
	manager: Pick<ClineCore, "delete">,
	onError: (error: unknown) => void,
) {
	let sides: ReturnType<typeof listTemporarySideConversations>;
	try {
		sides = listTemporarySideConversations();
	} catch (error) {
		onError(error);
		return;
	}
	for (const { sessionId, side } of sides) {
		try {
			if (side.owner && (await isSideConversationOwnerDead(side.owner))) {
				await deleteTemporarySideConversation(manager, sessionId);
			}
		} catch (error) {
			onError(error);
		}
	}
}
