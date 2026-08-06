"use client";

import type { ChatMessage } from "@/lib/chat-schema";
import { desktopClient } from "@/lib/desktop-client";

// ---------------------------------------------------------------------------
// Types mirrored from the sidecar's cloud-sessions service
// ---------------------------------------------------------------------------

export type CloudRemoteSession = {
	id: string;
	title?: string;
	status?: string;
	createdAt?: number | string;
	updatedAt?: number | string;
	expiredAt?: number | string;
	organizationId?: string | null;
	origin?: string;
	repoUrl?: string;
	modelId?: string;
};

export type CloudRepository = {
	id?: number | string;
	name?: string;
	fullName?: string;
	htmlUrl?: string;
	cloneUrl?: string;
	private?: boolean;
};

export type CloudModel = {
	id: string;
	name: string;
	description?: string;
	tags?: string[];
};

export type CloudGithubStatus = {
	connected: boolean;
	signedOut?: boolean;
	repositories: CloudRepository[];
	connectUrl: string;
};

export type CloudConnectionState =
	| "connecting"
	| "connected"
	| "reconnecting"
	| "disconnected"
	| "error";

export type CloudConnectSnapshot = {
	state: CloudConnectionState;
	agentSessionId: string | null;
	agentStatus: string | null;
	messages: ChatMessage[];
	usage: Record<string, unknown> | null;
};

export const DEFAULT_CLOUD_MODEL_ID = "anthropic/claude-sonnet-4.6";

// ---------------------------------------------------------------------------
// Command wrappers
// ---------------------------------------------------------------------------

export async function fetchCloudGithubStatus(
	organizationId?: string,
): Promise<CloudGithubStatus> {
	return await desktopClient.invoke<CloudGithubStatus>("cloud_github_status", {
		organizationId,
	});
}

export async function fetchCloudModels(): Promise<CloudModel[]> {
	const payload = await desktopClient.invoke<{ models: CloudModel[] }>(
		"cloud_list_models",
	);
	return payload.models ?? [];
}

export async function fetchCloudSessions(
	organizationId?: string,
): Promise<CloudRemoteSession[]> {
	const payload = await desktopClient.invoke<{
		sessions: CloudRemoteSession[];
	}>("cloud_list_sessions", { organizationId });
	return payload.sessions ?? [];
}

export async function createCloudSession(input: {
	modelId: string;
	repoUrl: string;
	title: string;
	organizationId?: string;
}): Promise<{ sessionId: string }> {
	// Provisioning a sandbox can legitimately take a while; do not let the
	// default command deadline abort it mid-flight.
	return await desktopClient.invoke<{ sessionId: string }>(
		"cloud_create_session",
		{ ...input },
		{ timeoutMs: 180_000 },
	);
}

export async function renameCloudSession(
	sessionId: string,
	title: string,
): Promise<void> {
	await desktopClient.invoke("cloud_rename_session", { sessionId, title });
}

export async function deleteCloudSession(sessionId: string): Promise<void> {
	await desktopClient.invoke("cloud_delete_session", { sessionId });
}

export async function fetchCloudSessionHistory(
	sessionId: string,
): Promise<ChatMessage[]> {
	const payload = await desktopClient.invoke<{ messages: ChatMessage[] }>(
		"cloud_session_history",
		{ sessionId },
	);
	return payload.messages ?? [];
}

export async function connectCloudSession(
	sessionId: string,
): Promise<CloudConnectSnapshot> {
	return await desktopClient.invoke<CloudConnectSnapshot>(
		"cloud_connect_session",
		{ sessionId },
		{ timeoutMs: 120_000 },
	);
}

export async function disconnectCloudSession(sessionId: string): Promise<void> {
	await desktopClient.invoke("cloud_disconnect_session", { sessionId });
}

export async function sendCloudPrompt(input: {
	sessionId: string;
	prompt: string;
	modelId?: string;
}): Promise<{ agentSessionId: string | null }> {
	return await desktopClient.invoke<{ agentSessionId: string | null }>(
		"cloud_send_prompt",
		{ ...input },
	);
}

export async function abortCloudRun(sessionId: string): Promise<void> {
	await desktopClient.invoke("cloud_abort_run", { sessionId });
}

export async function respondCloudApproval(input: {
	sessionId: string;
	approvalId: string;
	approved: boolean;
}): Promise<void> {
	await desktopClient.invoke("cloud_respond_approval", { ...input });
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function cloudSessionRepoName(session: CloudRemoteSession): string {
	const repoUrl = session.repoUrl?.trim();
	if (!repoUrl) {
		return "";
	}
	try {
		const parsed = new URL(repoUrl);
		const segments = parsed.pathname.split("/").filter(Boolean);
		if (segments.length >= 2) {
			return `${segments[segments.length - 2]}/${segments[segments.length - 1].replace(/\.git$/, "")}`;
		}
	} catch {
		// Fall through to the raw URL below.
	}
	return repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "");
}

export function cloudSessionTimestamp(
	value: number | string | undefined,
): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		// Seconds vs milliseconds: anything before ~2001 in ms is seconds.
		return value < 100_000_000_000 ? value * 1000 : value;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
}

export function isCloudSessionExpired(session: CloudRemoteSession): boolean {
	if (session.status?.toLowerCase() === "expired") {
		return true;
	}
	const expiresAt = cloudSessionTimestamp(session.expiredAt);
	return expiresAt !== null && expiresAt <= Date.now();
}
