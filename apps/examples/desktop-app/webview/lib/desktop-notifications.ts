"use client";

import {
	isPermissionGranted,
	requestPermission,
} from "@tauri-apps/plugin-notification";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";

const DESKTOP_NOTIFICATION_SETTINGS_STORAGE_KEY =
	"cline:desktop-notification-settings:v1";
const MAX_SEEN_REQUESTS = 500;

export const DESKTOP_NOTIFICATION_EVENT_TYPES = [
	"taskCompletion",
	"approvalNeeded",
	"questionAsked",
	"sessionError",
] as const;

export type DesktopNotificationEventType =
	(typeof DESKTOP_NOTIFICATION_EVENT_TYPES)[number];

export type DesktopNotificationPreference = {
	enabled: boolean;
	sound: boolean;
};

export type DesktopNotificationSettings = Record<
	DesktopNotificationEventType,
	DesktopNotificationPreference
>;

export type DesktopNotificationPermission =
	| NotificationPermission
	| "unsupported";

export const DEFAULT_DESKTOP_NOTIFICATION_SETTINGS: DesktopNotificationSettings =
	{
		taskCompletion: { enabled: true, sound: false },
		approvalNeeded: { enabled: true, sound: false },
		questionAsked: { enabled: true, sound: false },
		sessionError: { enabled: true, sound: false },
	};

type AgentChunkEvent = {
	sessionId?: unknown;
	stream?: unknown;
	chunk?: unknown;
};

type ToolApprovalItem = {
	requestId?: unknown;
	toolName?: unknown;
};

type AskQuestionItem = {
	requestId?: unknown;
	sessionId?: unknown;
	question?: unknown;
};

type TerminalKind = "completed" | "error" | "cancelled";

function cloneDefaultSettings(): DesktopNotificationSettings {
	return {
		taskCompletion: { ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS.taskCompletion },
		approvalNeeded: { ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS.approvalNeeded },
		questionAsked: { ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS.questionAsked },
		sessionError: { ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS.sessionError },
	};
}

function readPreference(
	value: unknown,
	fallback: DesktopNotificationPreference,
): DesktopNotificationPreference {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { ...fallback };
	}
	const record = value as Record<string, unknown>;
	return {
		enabled:
			typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
		sound: typeof record.sound === "boolean" ? record.sound : fallback.sound,
	};
}

export function readDesktopNotificationSettings(): DesktopNotificationSettings {
	const fallback = cloneDefaultSettings();
	if (typeof window === "undefined") {
		return fallback;
	}
	try {
		const raw = window.localStorage.getItem(
			DESKTOP_NOTIFICATION_SETTINGS_STORAGE_KEY,
		);
		if (!raw) {
			return fallback;
		}
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return {
			taskCompletion: readPreference(
				parsed.taskCompletion,
				fallback.taskCompletion,
			),
			approvalNeeded: readPreference(
				parsed.approvalNeeded,
				fallback.approvalNeeded,
			),
			questionAsked: readPreference(
				parsed.questionAsked,
				fallback.questionAsked,
			),
			sessionError: readPreference(parsed.sessionError, fallback.sessionError),
		};
	} catch {
		return fallback;
	}
}

export function writeDesktopNotificationSettings(
	settings: DesktopNotificationSettings,
): DesktopNotificationSettings {
	const normalized: DesktopNotificationSettings = {
		taskCompletion: readPreference(
			settings.taskCompletion,
			DEFAULT_DESKTOP_NOTIFICATION_SETTINGS.taskCompletion,
		),
		approvalNeeded: readPreference(
			settings.approvalNeeded,
			DEFAULT_DESKTOP_NOTIFICATION_SETTINGS.approvalNeeded,
		),
		questionAsked: readPreference(
			settings.questionAsked,
			DEFAULT_DESKTOP_NOTIFICATION_SETTINGS.questionAsked,
		),
		sessionError: readPreference(
			settings.sessionError,
			DEFAULT_DESKTOP_NOTIFICATION_SETTINGS.sessionError,
		),
	};
	if (typeof window !== "undefined") {
		window.localStorage.setItem(
			DESKTOP_NOTIFICATION_SETTINGS_STORAGE_KEY,
			JSON.stringify(normalized),
		);
	}
	return normalized;
}

export async function getDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
	if (!isTauriAvailable()) {
		return "unsupported";
	}
	try {
		if (await isPermissionGranted()) {
			return "granted";
		}
		return typeof Notification === "undefined"
			? "default"
			: Notification.permission;
	} catch {
		return "unsupported";
	}
}

export async function requestDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
	if (!isTauriAvailable()) {
		return "unsupported";
	}
	try {
		if (await isPermissionGranted()) {
			return "granted";
		}
		if (
			typeof Notification !== "undefined" &&
			Notification.permission === "denied"
		) {
			return "denied";
		}
		return await requestPermission();
	} catch {
		return "unsupported";
	}
}

function notificationSound(): string {
	const platform = navigator.userAgent.toLowerCase();
	if (platform.includes("mac")) {
		return "Ping";
	}
	if (platform.includes("linux")) {
		return "message-new-instant";
	}
	return "Default";
}

async function isMainWindowFocused(): Promise<boolean> {
	try {
		const { getCurrentWindow } = await import("@tauri-apps/api/window");
		return await getCurrentWindow().isFocused();
	} catch {
		return typeof document !== "undefined" && document.hasFocus();
	}
}

function asNonEmptyString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function concise(value: string, maxLength = 180): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > maxLength
		? `${normalized.slice(0, maxLength - 1)}…`
		: normalized;
}

function parseDoneChunk(chunk: unknown): { reason: string; text: string } {
	if (typeof chunk !== "string") {
		return { reason: "", text: "" };
	}
	try {
		const parsed = JSON.parse(chunk) as { reason?: unknown; text?: unknown };
		return {
			reason: asNonEmptyString(parsed.reason).toLowerCase(),
			text: asNonEmptyString(parsed.text),
		};
	} catch {
		return { reason: "", text: "" };
	}
}

function terminalKind(reason: string): TerminalKind | null {
	const normalized = reason.trim().toLowerCase();
	if (normalized === "error" || normalized === "failed") {
		return "error";
	}
	if (normalized === "aborted" || normalized === "cancelled") {
		return "cancelled";
	}
	if (
		normalized === "completed" ||
		normalized === "complete" ||
		normalized === "idle" ||
		normalized === "max_iterations" ||
		normalized === "mistake_limit"
	) {
		return "completed";
	}
	return null;
}

function addSeenRequest(seen: Set<string>, requestId: string): boolean {
	if (seen.has(requestId)) {
		return false;
	}
	seen.add(requestId);
	if (seen.size > MAX_SEEN_REQUESTS) {
		const oldest = seen.keys().next().value;
		if (typeof oldest === "string") {
			seen.delete(oldest);
		}
	}
	return true;
}

export function watchDesktopNotifications(): () => void {
	if (!isTauriAvailable()) {
		return () => {};
	}

	let disposed = false;
	let permissionRequest: Promise<DesktopNotificationPermission> | null = null;
	const seenApprovalRequests = new Set<string>();
	const seenQuestionRequests = new Set<string>();
	const terminalBySession = new Map<string, TerminalKind>();
	const queuedPromptsBySession = new Map<string, number>();

	const ensurePermission = () => {
		permissionRequest ??= requestDesktopNotificationPermission().finally(() => {
			permissionRequest = null;
		});
		return permissionRequest;
	};

	const notify = async (input: {
		eventType: DesktopNotificationEventType;
		sessionId: string;
		title: string;
		body: string;
	}) => {
		const preference = readDesktopNotificationSettings()[input.eventType];
		if (!preference.enabled || (await isMainWindowFocused()) || disposed) {
			return;
		}
		if ((await ensurePermission()) !== "granted" || disposed) {
			return;
		}
		try {
			await desktopClient.invoke("show_session_notification", {
				title: input.title,
				body: concise(input.body),
				sessionId: input.sessionId,
				sound: preference.sound ? notificationSound() : undefined,
			});
		} catch {
			// Native notifications are best-effort. Session handling must continue.
		}
	};

	const handleTerminal = (
		sessionId: string,
		kind: TerminalKind,
		detail = "",
	) => {
		if (!sessionId || terminalBySession.get(sessionId) === kind) {
			return;
		}
		terminalBySession.set(sessionId, kind);
		if (kind === "cancelled") {
			return;
		}
		if (kind === "completed") {
			if ((queuedPromptsBySession.get(sessionId) ?? 0) > 0) {
				return;
			}
			void notify({
				eventType: "taskCompletion",
				sessionId,
				title: "Task completed",
				body: "Cline finished working and the result is ready.",
			});
			return;
		}
		void notify({
			eventType: "sessionError",
			sessionId,
			title: "Task failed",
			body: detail || "Cline encountered an error while running this task.",
		});
	};

	const subscriptions = [
		desktopClient.subscribe("prompts_in_queue_state", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const record = payload as { sessionId?: unknown; items?: unknown };
			const sessionId = asNonEmptyString(record.sessionId);
			if (!sessionId) return;
			queuedPromptsBySession.set(
				sessionId,
				Array.isArray(record.items) ? record.items.length : 0,
			);
		}),
		desktopClient.subscribe("chat_event", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const event = payload as AgentChunkEvent;
			const sessionId = asNonEmptyString(event.sessionId);
			const stream = asNonEmptyString(event.stream);
			if (!sessionId || !stream) return;
			if (
				stream === "chat_queued_prompt_start" ||
				stream === "chat_tool_call_start" ||
				stream === "chat_text"
			) {
				terminalBySession.delete(sessionId);
				return;
			}
			if (stream !== "chat_done") return;
			const done = parseDoneChunk(event.chunk);
			const kind = terminalKind(done.reason || "completed");
			if (kind) handleTerminal(sessionId, kind, done.text);
		}),
		desktopClient.subscribe("chat_session_status", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const record = payload as { sessionId?: unknown; status?: unknown };
			const sessionId = asNonEmptyString(record.sessionId);
			const status = asNonEmptyString(record.status).toLowerCase();
			if (!sessionId || !status) return;
			if (status === "running" || status === "starting") {
				terminalBySession.delete(sessionId);
				return;
			}
			const kind = terminalKind(status);
			if (kind && status !== "idle") handleTerminal(sessionId, kind);
		}),
		desktopClient.subscribe("chat_session_ended", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const record = payload as { sessionId?: unknown; reason?: unknown };
			const sessionId = asNonEmptyString(record.sessionId);
			const reason = asNonEmptyString(record.reason);
			const kind = terminalKind(reason);
			if (sessionId && kind) handleTerminal(sessionId, kind);
		}),
		desktopClient.subscribe("tool_approval_state", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const record = payload as { sessionId?: unknown; items?: unknown };
			const sessionId = asNonEmptyString(record.sessionId);
			if (!sessionId || !Array.isArray(record.items)) return;
			for (const item of record.items as ToolApprovalItem[]) {
				const requestId = asNonEmptyString(item.requestId);
				if (!requestId || !addSeenRequest(seenApprovalRequests, requestId)) {
					continue;
				}
				const toolName = asNonEmptyString(item.toolName) || "A tool";
				void notify({
					eventType: "approvalNeeded",
					sessionId,
					title: "Approval needed",
					body: `${toolName} is waiting for your approval.`,
				});
			}
		}),
		desktopClient.subscribe("ask_question_requested", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const item = payload as AskQuestionItem;
			const requestId = asNonEmptyString(item.requestId);
			const sessionId = asNonEmptyString(item.sessionId);
			if (
				!requestId ||
				!sessionId ||
				!addSeenRequest(seenQuestionRequests, requestId)
			) {
				return;
			}
			void notify({
				eventType: "questionAsked",
				sessionId,
				title: "Cline has a question",
				body:
					asNonEmptyString(item.question) ||
					"Open this task to answer Cline's question.",
			});
		}),
	];

	// Ask while the app is active instead of waiting until the first background
	// event. Denials remain respected; Settings exposes a retry button.
	void ensurePermission();

	return () => {
		disposed = true;
		for (const unsubscribe of subscriptions) unsubscribe();
	};
}
