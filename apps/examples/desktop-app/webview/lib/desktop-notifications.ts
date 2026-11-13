"use client";

import {
	factoryDesignProgressSchema,
	factoryDesignReviewSchema,
	factoryTaskConfigSchema,
} from "@cline/shared/browser";
import {
	isPermissionGranted,
	requestPermission,
} from "@tauri-apps/plugin-notification";
import { z } from "zod";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";
import {
	currentFactoryConclusion,
	currentFactoryRunState,
	factoryAttentionReasons,
} from "./factory-attention";
import {
	FACTORY_OPEN_FINDINGS,
	FACTORY_SPLIT,
	factoryReviewRequest,
} from "./factory-copy";
import { eventEnvironmentId, sessionKey } from "./session-identity";

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

type NotificationTarget = { sessionId: string } | { factoryTaskId: string };

// Shared schemas use a different Zod major; a mismatch must reject the event,
// not throw out of the event handler.
function sharedSchema<T>(schema: {
	safeParse: (
		value: unknown,
	) => { success: true; data: T } | { success: false };
}) {
	return z.unknown().transform((value, context): T => {
		const result = schema.safeParse(value);
		if (result.success) return result.data;
		context.addIssue({ code: "custom", message: "Invalid Factory task" });
		return z.NEVER;
	});
}

// Hub task events carry the full task and, for execution updates, its run.
// Only the fields that decide task-level attention are read here; the plan
// gate reuses the shared schemas so it sees what core approval checks.
const factoryTaskEventSchema = z.object({
	task: z.object({
		taskId: z.string(),
		title: z.string(),
		status: z.string(),
		revision: z.number(),
		instructions: z.string(),
		archivedAt: z.string().optional(),
		error: z.string().optional(),
		updatedAt: z.string().optional(),
		originSessionId: z.string().optional(),
		factoryDesignSessionIds: z.array(z.string()).optional(),
		currentRunId: z.string().optional(),
		lastRunId: z.string().optional(),
		factory: sharedSchema(factoryTaskConfigSchema),
		factoryQuestions: z
			.array(
				z.object({
					questionId: z.string(),
					revision: z.number(),
					status: z.string(),
					question: z.string(),
				}),
			)
			.optional(),
		factoryDesignProgress: sharedSchema(factoryDesignProgressSchema).optional(),
		factoryDesignReview: sharedSchema(factoryDesignReviewSchema).optional(),
	}),
	run: z
		.object({
			runId: z.string(),
			taskRevision: z.number(),
			createdAt: z.string().optional(),
			status: z.string().optional(),
			sessionId: z.string().optional(),
			factory: z
				.object({
					phase: z.string(),
					humanApproval: z.unknown().optional(),
					// What factoryCardState reads: a proposed rule, a merged or
					// closed PR, and an older Hub's feedback stop.
					audit: z
						.object({
							finding: z.string().optional(),
							analysis: z.object({ status: z.string() }).optional(),
						})
						.optional(),
					pullRequestOutcome: z.object({ state: z.string() }).optional(),
					error: z.string().optional(),
					candidate: z.object({ commit: z.string() }).optional(),
					sessions: z.array(z.object({ sessionId: z.string() })).optional(),
					pullRequestWatch: z
						.object({
							pending: z.unknown().optional(),
							paused: z.boolean().optional(),
						})
						.optional(),
					pullRequestChecks: z
						.object({ status: z.string(), headCommit: z.string() })
						.optional(),
					pullRequestUrl: z.string().optional(),
					autoRecovery: z
						.object({
							attempts: z.number(),
							reason: z.string(),
							at: z.string(),
						})
						.optional(),
					humanReview: z
						.object({ required: z.boolean(), reason: z.string() })
						.optional(),
					unresolvedFindings: z
						.object({
							commit: z.string(),
							findings: z.array(z.string()),
							pullRequestOpen: z.boolean().optional(),
						})
						.optional(),
				})
				.optional(),
		})
		.optional(),
});
type FactoryTaskEvent = z.infer<typeof factoryTaskEventSchema>;

type FactoryAttentionEpisode = {
	key: string;
	eventType: DesktopNotificationEventType;
	title: string;
	body: string;
};

/**
 * The task's current attention episodes, most urgent first. Keys are stable
 * across repeated snapshots of the same question, plan revision, stop or
 * result. `unknown` marks keys this event can't rule out: an update without
 * the current run (spec edits, answers) says nothing about that run's outcome.
 */
function factoryAttention({ task, run }: FactoryTaskEvent): {
	episodes: FactoryAttentionEpisode[];
	unknown: (key: string) => boolean;
} {
	const name = concise(task.title, 80);
	const runId = task.currentRunId ?? task.lastRunId;
	const state = currentFactoryRunState(task, run);
	// One run's stop, finding, pause and result share this scope, so an update
	// without that run can keep them active.
	const outcome = `outcome:${task.taskId}:${task.revision}:${runId ?? task.originSessionId ?? ""}`;
	// The event carries one run. Passed as the card's only known run, a later
	// run on the same revision (a manual Try again) that already finished is
	// not taken for the automatic retry; the board and card read every run.
	const retryRuns =
		state && run?.createdAt
			? [{ ...run, createdAt: run.createdAt }]
			: undefined;
	const episodes = factoryAttentionReasons(task, state, retryRuns).map(
		(reason): FactoryAttentionEpisode => {
			switch (reason.kind) {
				case "question":
					return {
						key: `question:${task.taskId}:${reason.question.questionId}`,
						eventType: "questionAsked",
						title: "Factory needs your answer",
						body: `${name}: ${reason.question.question}`,
					};
				case "rule":
					return {
						key: `${outcome}:rule`,
						eventType: "sessionError",
						title: "Factory proposed a guidance rule",
						body: `${name}: save or discard the rule Factory proposed from your note.`,
					};
				case "stopped":
					return {
						key: `${outcome}:stopped`,
						eventType: "sessionError",
						title: "Factory work stopped",
						body: `${name} needs your decision before it can continue.`,
					};
				case "paused":
					return {
						key: `${outcome}:paused`,
						eventType: "taskCompletion",
						title: "Factory PR follow-up paused",
						body: `${name} is waiting for you to resume PR follow-up.`,
					};
				case "ready":
					return {
						key: `${outcome}:ready:${reason.commit ?? ""}`,
						eventType: "taskCompletion",
						...(reason.unresolvedFindings !== undefined
							? {
									title: FACTORY_OPEN_FINDINGS.notificationTitle,
									body: `${name}: ${FACTORY_OPEN_FINDINGS.headline(reason.unresolvedFindings)}.`,
								}
							: reason.humanReview?.required
								? {
										title: "Factory needs your review",
										body: `${name}: ${factoryReviewRequest(reason.humanReview.reason)}`,
									}
								: reason.pullRequestUrl
									? {
											title: "Draft PR ready for your review",
											body: `${name} passed its checks and reviews. Factory opened a draft PR.`,
										}
									: {
											title: "Factory result ready",
											body: `${name} passed its checks and reviews and is ready for you.`,
										}),
					};
				case "triage": {
					const duplicateOf = currentFactoryConclusion(task)?.duplicateOf;
					const finding =
						reason.outcome === "already_fixed"
							? "already fixed"
							: reason.outcome === "duplicate"
								? `duplicate of ${concise(duplicateOf ?? "another card", 80)}`
								: "no change needed";
					return {
						key: `triage:${task.taskId}:${task.revision}`,
						eventType: "approvalNeeded",
						title: "No build needed — confirm",
						body: `${name}: designer concluded ${finding}.`,
					};
				}
				case "breakdown":
					return {
						key: `breakdown:${task.taskId}:${task.revision}`,
						eventType: "approvalNeeded",
						title: FACTORY_SPLIT.notificationTitle,
						body: `${name}: ${FACTORY_SPLIT.notificationBody}`,
					};
				case "plan":
					return {
						key: `plan:${task.taskId}:${task.revision}`,
						eventType: "approvalNeeded",
						...(reason.blocker
							? {
									title: "Plan waiting for your approval",
									body: `${name}: automatic approval is waiting. ${concise(reason.blocker, 160)}`,
								}
							: {
									title: "Plan ready for your approval",
									body: `${name}: approve the plan and Factory builds it.`,
								}),
					};
				default: {
					const _exhaustive: never = reason;
					return _exhaustive;
				}
			}
		},
	);
	// A completed task's PR-follow-up stop or ready result lives only on its run.
	const runUnknown = !state && task.status === "completed" && Boolean(runId);
	return {
		episodes,
		unknown: (key) => runUnknown && key.startsWith(`${outcome}:`),
	};
}

/**
 * Sessions Factory started for its roles. Not `originSessionId`: before
 * design starts it names the chat or scheduled session that created the card,
 * whose own completion, errors and questions stay with that session.
 */
function factorySessionIds({ task, run }: FactoryTaskEvent): string[] {
	const progress = task.factoryDesignProgress;
	return [
		...(task.factoryDesignSessionIds ?? []),
		...(progress && progress.phase !== "designing"
			? progress.reviewerSessions
			: []
		).map((session) => session.sessionId),
		run?.sessionId,
		...(run?.factory?.sessions ?? []).map((session) => session.sessionId),
	].filter((sessionId): sessionId is string => Boolean(sessionId));
}

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

function keepRecent<V>(map: Map<string, V>, key: string, value: V): void {
	map.delete(key);
	map.set(key, value);
	for (const oldest of map.keys()) {
		if (map.size <= MAX_SEEN_REQUESTS) break;
		map.delete(oldest);
	}
}

export function watchDesktopNotifications(): () => void {
	if (!isTauriAvailable()) {
		return () => {};
	}

	let disposed = false;
	let permissionRequest: Promise<DesktopNotificationPermission> | null = null;
	const seenApprovalRequests = new Set<string>();
	const seenQuestionRequests = new Set<string>();
	const activeFactoryEpisodes = new Map<string, Set<string>>();
	// Factory role sessions are local; their attention is owned by the task.
	const factoryTaskBySession = new Map<string, string>();
	const terminalBySession = new Map<string, TerminalKind>();
	const queuedPromptsBySession = new Map<string, number>();
	const factoryTaskForSession = (environmentId: string, sessionId: string) =>
		environmentId === "local" ? factoryTaskBySession.get(sessionId) : undefined;

	const ensurePermission = () => {
		permissionRequest ??= requestDesktopNotificationPermission().finally(() => {
			permissionRequest = null;
		});
		return permissionRequest;
	};

	const notify = async (input: {
		eventType: DesktopNotificationEventType;
		target: NotificationTarget;
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
				...input.target,
				sound: preference.sound ? notificationSound() : undefined,
			});
		} catch {
			// Native notifications are best-effort. Session handling must continue.
		}
	};

	const handleTerminal = (
		environmentId: string,
		sessionId: string,
		kind: TerminalKind,
		detail = "",
	) => {
		const key = sessionKey({ sessionId, environmentId });
		if (
			!sessionId ||
			terminalBySession.get(key) === kind ||
			factoryTaskForSession(environmentId, sessionId)
		) {
			return;
		}
		terminalBySession.set(key, kind);
		if (kind === "cancelled") {
			return;
		}
		if (kind === "completed") {
			if ((queuedPromptsBySession.get(key) ?? 0) > 0) {
				return;
			}
			void notify({
				eventType: "taskCompletion",
				target: { sessionId },
				title: "Task completed",
				body: "Cline finished working and the result is ready.",
			});
			return;
		}
		void notify({
			eventType: "sessionError",
			target: { sessionId },
			title: "Task failed",
			body: detail || "Cline encountered an error while running this task.",
		});
	};

	// Task events already carry the task and run, so Factory attention needs no
	// extra fetch. An episode notifies once while it stays active, including
	// across redelivered snapshots after a reconnect; it notifies again only
	// after an event shows it ended. State is in memory, so an app restart
	// can notify an already-active episode on that task's next event.
	const handleFactoryTaskEvent = (payload: unknown) => {
		const parsed = factoryTaskEventSchema.safeParse(payload);
		if (!parsed.success) return;
		const { taskId } = parsed.data.task;
		for (const sessionId of factorySessionIds(parsed.data))
			keepRecent(factoryTaskBySession, sessionId, taskId);
		const { episodes, unknown } = factoryAttention(parsed.data);
		const previous = activeFactoryEpisodes.get(taskId) ?? new Set<string>();
		// Only the most urgent new episode notifies; others stay new for later.
		const fresh = episodes.find((episode) => !previous.has(episode.key));
		const active = new Set([
			...episodes
				.map((episode) => episode.key)
				.filter((key) => previous.has(key)),
			...[...previous].filter(unknown),
			...(fresh ? [fresh.key] : []),
		]);
		if (active.size) keepRecent(activeFactoryEpisodes, taskId, active);
		else activeFactoryEpisodes.delete(taskId);
		if (fresh)
			void notify({
				eventType: fresh.eventType,
				target: { factoryTaskId: taskId },
				title: fresh.title,
				body: fresh.body,
			});
	};

	const subscriptions = [
		desktopClient.subscribe("prompts_in_queue_state", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const record = payload as { sessionId?: unknown; items?: unknown };
			const sessionId = asNonEmptyString(record.sessionId);
			if (!sessionId) return;
			queuedPromptsBySession.set(
				sessionKey({ sessionId, environmentId: eventEnvironmentId(payload) }),
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
				terminalBySession.delete(
					sessionKey({ sessionId, environmentId: eventEnvironmentId(payload) }),
				);
				return;
			}
			if (stream !== "chat_done") return;
			const done = parseDoneChunk(event.chunk);
			const kind = terminalKind(done.reason || "completed");
			if (kind)
				handleTerminal(eventEnvironmentId(payload), sessionId, kind, done.text);
		}),
		desktopClient.subscribe("chat_session_status", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const record = payload as { sessionId?: unknown; status?: unknown };
			const sessionId = asNonEmptyString(record.sessionId);
			const status = asNonEmptyString(record.status).toLowerCase();
			if (!sessionId || !status) return;
			if (status === "running" || status === "starting") {
				terminalBySession.delete(
					sessionKey({ sessionId, environmentId: eventEnvironmentId(payload) }),
				);
				return;
			}
			const kind = terminalKind(status);
			if (kind && status !== "idle")
				handleTerminal(eventEnvironmentId(payload), sessionId, kind);
		}),
		desktopClient.subscribe("chat_session_ended", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const record = payload as { sessionId?: unknown; reason?: unknown };
			const sessionId = asNonEmptyString(record.sessionId);
			const reason = asNonEmptyString(record.reason);
			const kind = terminalKind(reason);
			if (sessionId && kind)
				handleTerminal(eventEnvironmentId(payload), sessionId, kind);
		}),
		desktopClient.subscribe("tool_approval_state", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const record = payload as { sessionId?: unknown; items?: unknown };
			const sessionId = asNonEmptyString(record.sessionId);
			if (!sessionId || !Array.isArray(record.items)) return;
			for (const item of record.items as ToolApprovalItem[]) {
				const requestId = asNonEmptyString(item.requestId);
				if (
					!requestId ||
					!addSeenRequest(
						seenApprovalRequests,
						sessionKey({
							sessionId: requestId,
							environmentId: eventEnvironmentId(payload),
						}),
					)
				) {
					continue;
				}
				const toolName = asNonEmptyString(item.toolName) || "A tool";
				void notify({
					eventType: "approvalNeeded",
					target: { sessionId },
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
				!addSeenRequest(
					seenQuestionRequests,
					sessionKey({
						sessionId: requestId,
						environmentId: eventEnvironmentId(payload),
					}),
				)
			) {
				return;
			}
			const factoryTaskId = factoryTaskForSession(
				eventEnvironmentId(payload),
				sessionId,
			);
			void notify({
				eventType: "questionAsked",
				target: factoryTaskId ? { factoryTaskId } : { sessionId },
				title: "Cline has a question",
				body:
					asNonEmptyString(item.question) ||
					"Open this task to answer Cline's question.",
			});
		}),
		...[
			"task.created",
			"task.updated",
			"task.run.started",
			"task.run.completed",
			"task.run.failed",
		].map((event) => desktopClient.subscribe(event, handleFactoryTaskEvent)),
	];

	// Ask while the app is active instead of waiting until the first background
	// event. Denials remain respected; Settings exposes a retry button.
	void ensurePermission();

	return () => {
		disposed = true;
		for (const unsubscribe of subscriptions) unsubscribe();
	};
}
