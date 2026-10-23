/**
 * The home screen's data model preserves the difference between known sessions
 * and endpoint-only computers. Flattening those into one visual list made a
 * computer look like work with an invented title; Home now groups them after
 * this module builds and honestly tags each row.
 *
 * Two sources, and they know different things:
 *
 *  - **Cloud** (`CloudSessionGateway.listRemoteSessions`) knows a title, workspace
 *    status and activity time. Opened connections supply live run/unread state.
 *  - **A paired machine** (`SavedEndpointsStore`) knows a url and a label, and
 *    nothing else. The phone cannot know what is happening on someone's laptop
 *    without connecting to it, so a machine row claims nothing about liveness or
 *    session content — it carries the one timestamp this device did observe (when
 *    *it* last opened that session, from `state/last-opened`) and says "Opened",
 *    not "Updated".
 *
 * The rules this module exists to keep honest:
 *  - `online` is true only where something observable says so — a cloud session
 *    the REST API reports as `running`, or the session this app is connected to
 *    right now. Never a guess from "we have a saved url".
 *  - `status` is absent when no status is known, so the chip is omitted rather
 *    than defaulting to "Idle".
 *  - a row with no timestamp shows no relative time at all.
 */

import { type ConnectionDescriptor, descriptorKey } from "@/connection";
import type { RemoteSession, RunStatus } from "@/session";
import type { SessionStatus } from "@/ui";
import { describeEndpoints } from "../endpoint-display";
import type { LocalMachineSession } from "./local-sessions";

export type SessionLocationKind = "cloud" | "machine";

export interface SessionLocation {
	kind: SessionLocationKind;
	/** Badge text: "Cloud pod", or the machine's own name ("MacBook Pro"). */
	name: string;
}

/** What we observed, and what the observation means. */
export interface SessionActivity {
	at: number;
	/** `updated` = the server's own timestamp; `opened` = this device's. */
	kind: "updated" | "opened";
}

export interface SessionRow {
	/** Stable list key. Same value as the chat route's `endpointKey`. */
	key: string;
	/** Whether this row represents known work or a legacy machine entry point. */
	kind: "session" | "computer";
	/** Primary line. A cloud/exact handoff title, or a paired computer's name. */
	title: string;
	/** Bounded initial-prompt snippet, only when the session source supplies it. */
	snippet?: string;
	location: SessionLocation;
	/**
	 * True only when liveness is genuinely observable. `false` means "not known to
	 * be online", NOT "offline" — the UI must not paint an offline dot from it.
	 */
	online: boolean;
	/** Status chip input. Absent when no status is known. */
	status?: SessionStatus;
	/** Distinguishes workspace availability from an observed agent run. */
	statusLabel?: string;
	canStopWorkspace?: boolean;
	unread?: boolean;
	activity?: SessionActivity;
	descriptor: ConnectionDescriptor;
}

export interface BuildSessionRowsInput {
	/** Paired local endpoints, in {@link SavedEndpointsStore} order. */
	endpoints: readonly ConnectionDescriptor[];
	/** Cloud sessions, when signed in and the list loaded. */
	cloudSessions?: readonly RemoteSession[];
	/** Real inner sessions observed by connecting to paired ClineCore hubs. */
	localSessions?: readonly LocalMachineSession[];
	/** core-api base recorded on cloud descriptors so the chat route can connect. */
	cloudApiBaseUrl?: string;
	/** `descriptorKey` -> epoch ms this device last opened it. */
	lastOpened?: Readonly<Record<string, number>>;
	/** The endpoint this app is connected to right now, if any. */
	activeKey?: string;
	/** Live run status of {@link activeKey}'s session. Observed, so trusted. */
	activeStatus?: RunStatus;
	cloudStatuses?: Readonly<Record<string, RunStatus>>;
	unreadCloudSessions?: ReadonlySet<string>;
}

/** Cloud statuses we can call "up right now". */
const ONLINE_CLOUD_STATUSES = new Set<RemoteSession["status"]>(["running"]);

export const CLOUD_BADGE = "Cloud pod";
export const UNTITLED_CLOUD_SESSION = "Untitled session";
export const UNTITLED_LOCAL_SESSION = "Untitled session";

/** `https://github.com/owner/repo.git` -> `owner/repo`. */
export function cloudRepositoryLabel(repoUrl?: string): string {
	if (!repoUrl?.trim()) return CLOUD_BADGE;
	const normalized = repoUrl
		.trim()
		.replace(/\.git$/i, "")
		.replace(/\/+$/, "");
	const parts = normalized.split(/[/:]/).filter(Boolean);
	return parts.length >= 2 ? parts.slice(-2).join("/") : CLOUD_BADGE;
}

export function cloudSessionContext(
	descriptor: Pick<ConnectionDescriptor, "repoUrl" | "branch">,
): string {
	return descriptor.repoUrl?.trim()
		? [cloudRepositoryLabel(descriptor.repoUrl), descriptor.branch?.trim()]
				.filter(Boolean)
				.join(" · ")
		: "Cline Cloud";
}

function localStatus(status?: string): SessionStatus | undefined {
	switch (status) {
		case "idle":
		case "running":
		case "completed":
		case "failed":
		case "aborted":
			return status;
		case "pending":
			return "running";
		case "cancelled":
			return "aborted";
		default:
			return undefined;
	}
}

/**
 * Flatten both sources into one newest-first list.
 *
 * Ordering: rows with a real timestamp come first, newest first. Rows with no
 * timestamp keep their source order behind them — a machine this device has never
 * opened has no recency to claim, so it is not allowed to jump the queue.
 */
export function buildSessionRows(
	input: BuildSessionRowsInput,
): readonly SessionRow[] {
	const lastOpened = input.lastOpened ?? {};

	// Labels are disambiguated across the whole machine list, so two hubs saved
	// from the same computer never render the same badge.
	const discoveredKeys = new Set(
		(input.localSessions ?? []).map((session) =>
			descriptorKey({
				...session.descriptor,
				hubSessionId: session.sessionId,
			}),
		),
	);
	const machineRows: SessionRow[] = describeEndpoints([
		...input.endpoints.filter((endpoint) => endpoint.mode === "local"),
	])
		.filter((display) => !discoveredKeys.has(display.key))
		.map((display) => {
			const isActive = display.key === input.activeKey;
			const at = lastOpened[display.key];
			const liveStatus =
				(isActive ? input.activeStatus : undefined) ??
				input.cloudStatuses?.[display.key];
			return {
				key: display.key,
				kind: display.endpoint.hubSessionId ? "session" : "computer",
				title:
					display.endpoint.sessionTitle?.trim() ||
					(display.endpoint.hubSessionId ? "Cline session" : display.label),
				location: {
					kind: "machine",
					name: display.endpoint.hubSessionId
						? display.label
						: "Paired computer",
				},
				online: liveStatus !== undefined,
				unread:
					!isActive && input.unreadCloudSessions?.has(display.key) === true,
				...(liveStatus ? { status: liveStatus } : {}),
				...(at !== undefined
					? { activity: { at, kind: "opened" as const } }
					: {}),
				descriptor: display.endpoint,
			};
		});

	const localSessionRows: SessionRow[] = (input.localSessions ?? []).map(
		(session) => {
			const descriptor: ConnectionDescriptor = {
				...session.descriptor,
				hubSessionId: session.sessionId,
				...(session.title ? { sessionTitle: session.title } : {}),
				...(session.providerId ? { providerId: session.providerId } : {}),
				...(session.modelId ? { modelId: session.modelId } : {}),
			};
			const key = descriptorKey(descriptor);
			const isActive = key === input.activeKey;
			const liveStatus =
				(isActive ? input.activeStatus : undefined) ??
				input.cloudStatuses?.[key];
			const status = liveStatus ?? localStatus(session.status);
			const at = session.updatedAt ?? session.createdAt;
			return {
				key,
				kind: "session",
				title: session.title?.trim() || UNTITLED_LOCAL_SESSION,
				...(session.prompt?.trim()
					? { snippet: sessionSnippet(session.prompt) }
					: {}),
				location: {
					kind: "machine",
					name: session.descriptor.label?.trim() || "My computer",
				},
				// The list was read from a live hub. A running status is therefore an
				// observation, not the old "saved url means online" guess.
				online:
					liveStatus !== undefined ||
					status === "running" ||
					(isActive && status !== undefined),
				unread: !isActive && input.unreadCloudSessions?.has(key) === true,
				...(status ? { status } : {}),
				...(at !== undefined
					? { activity: { at, kind: "updated" as const } }
					: {}),
				descriptor,
			};
		},
	);

	const cloudRows: SessionRow[] = (input.cloudSessions ?? []).map((session) => {
		const savedDescriptor = input.endpoints.find(
			(endpoint) =>
				endpoint.mode === "cloud" &&
				(endpoint.organizationId ?? undefined) ===
					(session.organizationId ?? undefined) &&
				((endpoint.remoteSessionId !== undefined &&
					endpoint.remoteSessionId === session.id) ||
					(endpoint.remoteSessionId === undefined &&
						endpoint.url === session.sandboxUrl)),
		);
		const descriptor: ConnectionDescriptor = {
			...savedDescriptor,
			mode: "cloud",
			url: session.sandboxUrl,
			remoteSessionId: session.id,
			label: session.title ?? CLOUD_BADGE,
			providerId: "cline",
			...(session.repoUrl ? { repoUrl: session.repoUrl } : {}),
			...(session.branch ? { branch: session.branch } : {}),
			...(session.organizationId
				? { organizationId: session.organizationId }
				: {}),
			...(session.modelId ? { modelId: session.modelId } : {}),
			...(input.cloudApiBaseUrl ? { apiBaseUrl: input.cloudApiBaseUrl } : {}),
		};
		const at = session.lastActivityAt ?? session.createdAt;
		const key = descriptorKey(descriptor);
		const liveStatus =
			(key === input.activeKey ? input.activeStatus : undefined) ??
			input.cloudStatuses?.[key];
		return {
			key,
			kind: "session",
			title: session.title?.trim() || UNTITLED_CLOUD_SESSION,
			unread:
				key !== input.activeKey && input.unreadCloudSessions?.has(key) === true,
			location: { kind: "cloud", name: cloudRepositoryLabel(session.repoUrl) },
			// The REST status is a real observation of the pod.
			online: ONLINE_CLOUD_STATUSES.has(session.status),
			canStopWorkspace:
				session.sandboxType === "resumable" && session.status === "running",
			// A healthy sandbox says nothing about agent activity. Keep ordinary
			// rows quiet; show observed work or actionable workspace states only.
			status:
				session.status === "running" || session.status === "unknown"
					? liveStatus
					: session.status,
			...(at !== undefined
				? { activity: { at, kind: "updated" as const } }
				: {}),
			descriptor,
		};
	});

	return [...machineRows, ...localSessionRows, ...cloudRows]
		.map((row, index) => ({ row, index }))
		.sort((a, b) => {
			const left = a.row.activity?.at;
			const right = b.row.activity?.at;
			if (left !== undefined && right !== undefined) {
				return right - left || a.index - b.index;
			}
			if (left !== undefined) {
				return -1;
			}
			if (right !== undefined) {
				return 1;
			}
			return a.index - b.index;
		})
		.map((entry) => entry.row);
}

const MAX_SESSION_SNIPPET = 160;

/** Keep row text and VoiceOver hints useful even when the first prompt is huge. */
export function sessionSnippet(prompt: string): string {
	const normalized = prompt.trim().replace(/\s+/g, " ");
	if (normalized.length <= MAX_SESSION_SNIPPET) return normalized;
	return `${normalized.slice(0, MAX_SESSION_SNIPPET - 1).trimEnd()}…`;
}

/** Case-insensitive filter over the text a row actually shows. */
export function filterSessionRows(
	rows: readonly SessionRow[],
	query: string,
): readonly SessionRow[] {
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return rows;
	}
	return rows.filter((row) =>
		`${row.title} ${row.snippet ?? ""} ${row.location.name} ${row.descriptor.url}`
			.toLowerCase()
			.includes(needle),
	);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Coarse relative time — the precision a list row can honestly carry. A future
 * timestamp (a machine's clock running ahead) reads as "just now" rather than
 * "in 3 minutes".
 */
export function formatRelativeTime(at: number, now: number): string {
	const elapsed = now - at;
	if (elapsed < MINUTE) {
		return "just now";
	}
	if (elapsed < HOUR) {
		return `${Math.floor(elapsed / MINUTE)}m ago`;
	}
	if (elapsed < DAY) {
		return `${Math.floor(elapsed / HOUR)}h ago`;
	}
	if (elapsed < 7 * DAY) {
		return `${Math.floor(elapsed / DAY)}d ago`;
	}
	return `${Math.floor(elapsed / (7 * DAY))}w ago`;
}

/**
 * The row's time line, naming what the time means. `undefined` when nothing was
 * observed — the row then shows no time rather than a fabricated one.
 */
export function describeActivity(
	row: SessionRow,
	now: number,
): string | undefined {
	if (!row.activity) {
		return undefined;
	}
	const relative = formatRelativeTime(row.activity.at, now);
	return row.activity.kind === "updated"
		? `Updated ${relative}`
		: `Opened ${relative}`;
}
