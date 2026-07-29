/**
 * Hub drive_agent_home_get — load `.driveagent/<slug>/` and return compiled view.
 */

import {
	compileDriveagentHome,
	DriveagentHomeCompileError,
} from "@cline/drive";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import {
	DriveagentHomeLoadError,
	loadDriveagentHome,
} from "../../drive-home";
import { errorReply, type HubTransportContext, okReply } from "./context";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function handleDriveHomeCommand(
	_ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	switch (envelope.command) {
		case "drive_agent_home_get":
			return handleDriveAgentHomeGet(envelope);
		default:
			return errorReply(
				envelope,
				"not_implemented",
				`Unknown drive home command: ${envelope.command}`,
			);
	}
}

function handleDriveAgentHomeGet(
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const workspaceRoot = readString(envelope.payload, "workspaceRoot");
	const slug = readString(envelope.payload, "slug");
	if (!workspaceRoot) {
		return errorReply(
			envelope,
			"invalid_payload",
			"workspaceRoot is required",
		);
	}
	if (!slug) {
		return errorReply(envelope, "invalid_payload", "slug is required");
	}

	try {
		const loaded = loadDriveagentHome({ workspaceRoot, slug });
		const compiled = compileDriveagentHome(loaded.home);
		return okReply(envelope, {
			home: loaded.home,
			compiled,
		});
	} catch (error) {
		if (error instanceof DriveagentHomeLoadError) {
			return errorReply(envelope, error.code, error.message);
		}
		if (error instanceof DriveagentHomeCompileError) {
			return errorReply(envelope, error.code, error.message);
		}
		return errorReply(
			envelope,
			"invalid_home",
			error instanceof Error ? error.message : String(error),
		);
	}
}
