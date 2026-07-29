/** Webview bridge for hub `drive_agent_home_get` (DRV-DRIVEAGENT-HOME). */

import { postToHost } from "../vscode";

const HOME_TIMEOUT_MS = 3_000;

export type DriveagentHomeProjection = {
	slug: string;
	agent: {
		name: string;
		description: string;
		tools?: string[];
		skills?: string[];
		editable?: boolean;
	};
	permissions: {
		presetIntent: "readonly" | "standard" | "full";
		approvalHooks: string[];
		notes?: string;
	};
	compiled: {
		name: string;
		slug: string;
		description: string;
		tools?: string[];
		skills?: string[];
	};
};

type HomeReplyMessage = {
	type?: string;
	requestId?: string;
	home?: {
		slug: string;
		agent: DriveagentHomeProjection["agent"];
		permissions: DriveagentHomeProjection["permissions"];
	};
	compiled?: DriveagentHomeProjection["compiled"];
	text?: string;
};

/**
 * Request hub `drive_agent_home_get` and resolve with a prompt-stripped home.
 * Rejects on error reply or timeout (~3s).
 */
export function requestDriveagentHome(
	workspaceRoot: string,
	slug: string,
	options?: { timeoutMs?: number },
): Promise<DriveagentHomeProjection> {
	const timeoutMs = options?.timeoutMs ?? HOME_TIMEOUT_MS;
	const root = workspaceRoot.trim();
	const homeSlug = slug.trim();
	if (!root) {
		return Promise.reject(new Error("workspaceRoot is required"));
	}
	if (!homeSlug) {
		return Promise.reject(new Error("slug is required"));
	}

	const requestId = `drive-home-${Date.now()}-${Math.random().toString(36).slice(2)}`;

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			window.removeEventListener("message", onMessage);
			reject(new Error("drive_agent_home_get timed out"));
		}, timeoutMs);

		function onMessage(event: MessageEvent) {
			const message = event.data as HomeReplyMessage;
			if (
				message.type !== "drive_agent_home" &&
				message.type !== "drive_agent_home_error"
			) {
				return;
			}
			if (message.requestId !== requestId) {
				return;
			}
			clearTimeout(timer);
			window.removeEventListener("message", onMessage);
			if (message.type === "drive_agent_home_error") {
				reject(
					new Error(
						message.text?.trim() || "drive_agent_home_get failed",
					),
				);
				return;
			}
			if (!message.home || !message.compiled) {
				reject(new Error("drive_agent_home missing home/compiled"));
				return;
			}
			resolve({
				slug: message.home.slug,
				agent: message.home.agent,
				permissions: message.home.permissions,
				compiled: message.compiled,
			});
		}

		window.addEventListener("message", onMessage);
		postToHost({
			type: "drive_agent_home_get",
			requestId,
			workspaceRoot: root,
			slug: homeSlug,
		});
	});
}
