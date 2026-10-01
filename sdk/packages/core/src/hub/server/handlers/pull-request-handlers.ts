import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { createPullRequestStatusReader } from "../../../services/workspace/pull-request";
import {
	errorReply,
	extractSessionId,
	type HubTransportContext,
	okReply,
} from "./context";

// Installation tokens (including cloud's authenticated egress proxy) cannot
// identify a user. The reader's repository query verifies access instead.
const readPullRequestStatus = createPullRequestStatusReader({
	probeAuthentication: false,
});

export async function handleSessionPullRequestStatus(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const sessionId = extractSessionId(envelope);
	if (
		!sessionId ||
		Object.keys(envelope.payload ?? {}).some((key) => key !== "sessionId")
	) {
		return errorReply(
			envelope,
			"invalid_request",
			"session.pull_request_status accepts only a session id",
		);
	}
	const session = await ctx.sessionHost.getSession(sessionId);
	if (!session) {
		return errorReply(
			envelope,
			"session_not_found",
			`Unknown session: ${sessionId}`,
		);
	}
	const cwd = session.cwd?.trim() || session.workspaceRoot?.trim();
	if (!cwd) {
		return errorReply(
			envelope,
			"workspace_unavailable",
			"The session has no workspace",
		);
	}
	try {
		return okReply(envelope, {
			sessionId,
			status: await readPullRequestStatus(cwd),
		});
	} catch {
		return errorReply(
			envelope,
			"pull_request_status_unavailable",
			"Could not load pull request status. Check your connection and try again.",
		);
	}
}
