/**
 * The home list's contract: newest first, badges that name the location, and —
 * the part worth guarding — no invented liveness. A machine we are not connected
 * to gets no dot, no status chip and no timestamp.
 */

import { describe, expect, it } from "vitest";
import type { ConnectionDescriptor } from "@/connection";
import { descriptorKey } from "@/connection";
import { asRemoteSessionId, type RemoteSession } from "@/session";
import {
	buildSessionRows,
	CLOUD_BADGE,
	cloudSessionContext,
	describeActivity,
	filterSessionRows,
	formatRelativeTime,
	UNTITLED_CLOUD_SESSION,
} from "./session-rows";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const LAPTOP: ConnectionDescriptor = {
	mode: "local",
	url: "ws://192.168.1.20:4599/hub",
	label: "MacBook Pro",
	authToken: "secret",
};
const DESKTOP: ConnectionDescriptor = {
	mode: "local",
	url: "ws://192.168.1.31:4599/hub",
	label: "Studio",
};

function cloudSession(overrides: Partial<RemoteSession> = {}): RemoteSession {
	return {
		id: asRemoteSessionId("sess_1"),
		sandboxUrl: "https://pod-1.cline.bot/hub",
		status: "running",
		expiredAt: null,
		modelId: "anthropic/claude",
		title: "Fix the flaky test",
		lastActivityAt: NOW - 5 * MINUTE,
		...overrides,
	};
}

describe("buildSessionRows", () => {
	it("offers stop only for a running resumable workspace regardless of agent run status", () => {
		const rows = buildSessionRows({
			endpoints: [],
			cloudSessions: [
				cloudSession({
					id: asRemoteSessionId("ready"),
					sandboxType: "resumable",
				}),
				cloudSession({
					id: asRemoteSessionId("starting"),
					sandboxType: "resumable",
					status: "provisioning",
				}),
				cloudSession({
					id: asRemoteSessionId("paused"),
					sandboxType: "resumable",
					status: "suspended",
				}),
				cloudSession({
					id: asRemoteSessionId("standard"),
					sandboxType: "standard",
				}),
			],
		});
		expect(rows.map((row) => row.canStopWorkspace)).toEqual([
			true,
			false,
			false,
			false,
		]);
	});
	it("carries Cloud repo/branch context without changing connection identity", () => {
		const [row] = buildSessionRows({
			endpoints: [],
			cloudSessions: [
				cloudSession({
					repoUrl: "https://github.com/cline/cline.git",
					branch: "feature/mobile",
				}),
			],
		});
		expect(row?.descriptor).toMatchObject({
			repoUrl: "https://github.com/cline/cline.git",
			branch: "feature/mobile",
		});
		expect(cloudSessionContext(row!.descriptor)).toBe(
			"cline/cline · feature/mobile",
		);
		expect(
			cloudSessionContext({ repoUrl: "https://github.com/cline/cline" }),
		).toBe("cline/cline");
		expect(cloudSessionContext({})).toBe("Cline Cloud");
	});
	it("passes unread activity to Cloud rows except the selected session", () => {
		const input = { endpoints: [], cloudSessions: [cloudSession()] };
		const [row] = buildSessionRows(input);
		const unreadCloudSessions = new Set([row!.key]);
		expect(buildSessionRows({ ...input, unreadCloudSessions })[0]?.unread).toBe(
			true,
		);
		expect(
			buildSessionRows({
				...input,
				unreadCloudSessions,
				activeKey: row!.key,
			})[0]?.unread,
		).toBe(false);
	});
	it("uses live statuses for previously opened sessions, not just the selected row", () => {
		const cloudSessions = [
			cloudSession(),
			cloudSession({ id: asRemoteSessionId("b"), sandboxUrl: "https://b/hub" }),
		];
		const input = { endpoints: [], cloudSessions };
		const [a, b] = buildSessionRows(input);
		const rows = buildSessionRows({
			...input,
			activeKey: b!.key,
			activeStatus: "idle",
			cloudStatuses: { [a!.key]: "running" },
		});
		expect(rows.map((row) => row.status)).toEqual(["running", "idle"]);
	});
	it("does not reorder a session on reconnect", () => {
		const old = cloudSession({
			id: asRemoteSessionId("old"),
			lastActivityAt: NOW - HOUR,
			updatedAt: NOW,
		});
		const recent = cloudSession({
			id: asRemoteSessionId("recent"),
			sandboxUrl: "https://recent/hub",
			lastActivityAt: NOW - MINUTE,
		});
		const rows = buildSessionRows({
			endpoints: [],
			cloudSessions: [old, recent],
		});
		expect(rows.map((row) => row.descriptor.remoteSessionId)).toEqual([
			"recent",
			"old",
		]);
		expect(rows[1]?.activity?.at).toBe(NOW - HOUR);
	});
	it("never infers agent activity from missing workspace status", () => {
		const [row] = buildSessionRows({
			endpoints: [],
			cloudSessions: [cloudSession({ status: "unknown" })],
		});
		expect(row?.online).toBe(false);
		expect(row?.status).toBeUndefined();
	});
	it("distinguishes a ready Cloud workspace from its live agent status", () => {
		const input = { endpoints: [], cloudSessions: [cloudSession()] };
		const [ready] = buildSessionRows(input);
		expect(ready?.status).toBeUndefined();
		expect(ready?.statusLabel).toBeUndefined();
		for (const activeStatus of ["idle", "running", "failed"] as const) {
			const [live] = buildSessionRows({
				...input,
				activeKey: ready!.key,
				activeStatus,
			});
			expect(live?.status).toBe(activeStatus);
			expect(live?.statusLabel).toBeUndefined();
		}
	});
	it("names the location without ever offering it as a choice", () => {
		const rows = buildSessionRows({
			endpoints: [LAPTOP],
			cloudSessions: [cloudSession()],
		});
		const machine = rows.find((row) => row.location.kind === "machine");
		const cloud = rows.find((row) => row.location.kind === "cloud");
		expect(machine?.location.name).toBe("Paired computer");
		expect(machine?.title).toBe("MacBook Pro");
		expect(machine?.kind).toBe("computer");
		expect(cloud?.location.name).toBe(CLOUD_BADGE);
		expect(cloud?.title).toBe("Fix the flaky test");
	});

	it("uses the Cloud repository as useful session context", () => {
		const [row] = buildSessionRows({
			endpoints: [],
			cloudSessions: [
				cloudSession({ repoUrl: "https://github.com/cline/cline.git" }),
			],
		});
		expect(row?.location.name).toBe("cline/cline");
	});

	it("orders every row with a real timestamp newest first", () => {
		const rows = buildSessionRows({
			endpoints: [LAPTOP, DESKTOP],
			cloudSessions: [
				cloudSession({
					id: asRemoteSessionId("old"),
					title: "Old cloud",
					lastActivityAt: NOW - 3 * DAY,
				}),
				cloudSession({
					id: asRemoteSessionId("new"),
					title: "New cloud",
					lastActivityAt: NOW - MINUTE,
				}),
			],
			lastOpened: {
				[descriptorKey(LAPTOP)]: NOW - 2 * HOUR,
				[descriptorKey(DESKTOP)]: NOW - 4 * DAY,
			},
		});
		expect(rows.map((row) => row.title)).toEqual([
			"New cloud",
			"MacBook Pro", // laptop, 2h
			"Old cloud",
			"Studio", // studio, 4d
		]);
		expect(rows[1]?.location.name).toBe("Paired computer");
		expect(rows[3]?.location.name).toBe("Paired computer");
	});

	it("keeps rows with nothing observed behind the ones with a timestamp", () => {
		const rows = buildSessionRows({
			endpoints: [LAPTOP, DESKTOP],
			cloudSessions: [
				cloudSession({ title: "Cloud", lastActivityAt: NOW - DAY }),
			],
			lastOpened: { [descriptorKey(DESKTOP)]: NOW - MINUTE },
		});
		// Studio (just opened), then the cloud session, then the never-opened laptop.
		expect(rows.map((row) => row.location.name)).toEqual([
			"Paired computer",
			CLOUD_BADGE,
			"Paired computer",
		]);
		expect(rows[2]?.activity).toBeUndefined();
	});

	it("falls back to createdAt, ignoring reconnect updates without activity", () => {
		const [row] = buildSessionRows({
			endpoints: [],
			cloudSessions: [
				cloudSession({
					lastActivityAt: undefined,
					updatedAt: NOW,
					createdAt: NOW - HOUR,
				}),
			],
		});
		expect(row?.activity).toEqual({ at: NOW - HOUR, kind: "updated" });
	});

	it("titles an untitled cloud session rather than showing its id", () => {
		const [row] = buildSessionRows({
			endpoints: [],
			cloudSessions: [cloudSession({ title: undefined })],
		});
		expect(row?.title).toBe(UNTITLED_CLOUD_SESSION);
	});

	it("marks a cloud pod online only when REST says it is running", () => {
		for (const status of [
			"provisioning",
			"stopped",
			"expired",
			"failed",
		] as const) {
			const [row] = buildSessionRows({
				endpoints: [],
				cloudSessions: [cloudSession({ status })],
			});
			expect(row?.online).toBe(false);
			// The status is still shown — that is an observation, unlike a dot.
			expect(row?.status).toBe(status);
		}
		const [running] = buildSessionRows({
			endpoints: [],
			cloudSessions: [cloudSession({ status: "running" })],
		});
		expect(running?.online).toBe(true);
	});

	it("claims nothing about a machine it is not connected to", () => {
		const [row] = buildSessionRows({ endpoints: [LAPTOP] });
		expect(row?.online).toBe(false);
		expect(row?.status).toBeUndefined();
		expect(row?.activity).toBeUndefined();
	});

	it("shows the live status of the machine it IS connected to", () => {
		const rows = buildSessionRows({
			endpoints: [LAPTOP, DESKTOP],
			activeKey: descriptorKey(LAPTOP),
			activeStatus: "running",
		});
		const laptop = rows.find((row) => row.key === descriptorKey(LAPTOP));
		const studio = rows.find((row) => row.key === descriptorKey(DESKTOP));
		expect(laptop?.online).toBe(true);
		expect(laptop?.status).toBe("running");
		expect(studio?.online).toBe(false);
		expect(studio?.status).toBeUndefined();
	});

	it("disambiguates two hubs saved from the same machine", () => {
		const rows = buildSessionRows({
			endpoints: [
				{
					mode: "local",
					url: "ws://127.0.0.1:4599/hub",
					label: "Local dev hub",
				},
				{
					mode: "local",
					url: "ws://127.0.0.1:25463/hub",
					label: "Local dev hub",
				},
			],
		});
		expect(rows.map((row) => row.title)).toEqual([
			"Local dev hub (:4599)",
			"Local dev hub (:25463)",
		]);
	});

	it("keys a row the same way the chat route resolves it", () => {
		const [row] = buildSessionRows({ endpoints: [LAPTOP] });
		expect(row?.key).toBe(descriptorKey(LAPTOP));
	});

	it("carries the api base and remote id a cloud session needs to connect", () => {
		const [row] = buildSessionRows({
			endpoints: [],
			cloudSessions: [cloudSession()],
			cloudApiBaseUrl: "https://core-api.example",
		});
		expect(row?.descriptor).toMatchObject({
			mode: "cloud",
			url: "https://pod-1.cline.bot/hub",
			remoteSessionId: "sess_1",
			modelId: "anthropic/claude",
			apiBaseUrl: "https://core-api.example",
		});
	});

	it("preserves the exact inner-session pin when Cloud refreshes its outer row", () => {
		const [row] = buildSessionRows({
			endpoints: [
				{
					mode: "cloud",
					url: "https://old-pod.example/hub",
					remoteSessionId: "sess_1",
					hubSessionId: "inner-7",
					organizationId: "org-1",
				},
			],
			cloudSessions: [cloudSession({ organizationId: "org-1" })],
			cloudApiBaseUrl: "https://core-api.example",
		});
		expect(row?.descriptor).toMatchObject({
			url: "https://pod-1.cline.bot/hub",
			remoteSessionId: "sess_1",
			hubSessionId: "inner-7",
			organizationId: "org-1",
		});
	});

	it("ignores cloud descriptors saved in the endpoint store (the cloud list owns them)", () => {
		const rows = buildSessionRows({
			endpoints: [
				LAPTOP,
				{ mode: "cloud", url: "https://pod-1.cline.bot/hub", label: "Cloud" },
			],
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]?.location.kind).toBe("machine");
	});

	it("degrades to machines only when the cloud list is unavailable", () => {
		const rows = buildSessionRows({ endpoints: [LAPTOP, DESKTOP] });
		expect(rows).toHaveLength(2);
	});

	it("renders discovered inner machine sessions with exact resume descriptors", () => {
		const [row] = buildSessionRows({
			endpoints: [LAPTOP],
			localSessions: [
				{
					descriptor: LAPTOP,
					sessionId: "ses_local",
					title: "Fix the iOS keyboard",
					prompt: "The composer is hidden when the keyboard opens",
					status: "running",
					updatedAt: NOW - MINUTE,
				},
			],
		});
		expect(row).toMatchObject({
			kind: "session",
			title: "Fix the iOS keyboard",
			snippet: "The composer is hidden when the keyboard opens",
			location: { kind: "machine", name: "MacBook Pro" },
			status: "running",
			online: true,
			activity: { at: NOW - MINUTE, kind: "updated" },
			descriptor: {
				hubSessionId: "ses_local",
				sessionTitle: "Fix the iOS keyboard",
			},
		});
	});

	it("bounds a machine's initial-prompt snippet", () => {
		const row = buildSessionRows({
			endpoints: [LAPTOP],
			localSessions: [
				{
					descriptor: LAPTOP,
					sessionId: "ses_long",
					prompt: "x".repeat(240),
				},
			],
		}).find((candidate) => candidate.kind === "session");
		expect(row?.snippet).toHaveLength(160);
		expect(row?.snippet?.endsWith("…")).toBe(true);
	});
});

describe("filterSessionRows", () => {
	const rows = buildSessionRows({
		endpoints: [LAPTOP],
		cloudSessions: [cloudSession()],
	});

	it("returns everything for an empty query", () => {
		expect(filterSessionRows(rows, "   ")).toHaveLength(2);
	});

	it("matches the title, the location badge and the url", () => {
		expect(filterSessionRows(rows, "flaky")).toHaveLength(1);
		expect(filterSessionRows(rows, "macbook")).toHaveLength(1);
		expect(filterSessionRows(rows, "192.168")).toHaveLength(1);
		expect(filterSessionRows(rows, "nothing here")).toHaveLength(0);
	});
});

describe("relative time", () => {
	it("uses a coarseness a list row can honestly carry", () => {
		expect(formatRelativeTime(NOW - 5_000, NOW)).toBe("just now");
		expect(formatRelativeTime(NOW - 3 * MINUTE, NOW)).toBe("3m ago");
		expect(formatRelativeTime(NOW - 5 * HOUR, NOW)).toBe("5h ago");
		expect(formatRelativeTime(NOW - 3 * DAY, NOW)).toBe("3d ago");
		expect(formatRelativeTime(NOW - 30 * DAY, NOW)).toBe("4w ago");
	});

	it("does not report the future when a clock runs ahead", () => {
		expect(formatRelativeTime(NOW + 5 * MINUTE, NOW)).toBe("just now");
	});

	it("says what the time means, and says nothing when nothing was observed", () => {
		const [cloud] = buildSessionRows({
			endpoints: [],
			cloudSessions: [cloudSession({ lastActivityAt: NOW - 2 * MINUTE })],
		});
		const [machine] = buildSessionRows({
			endpoints: [LAPTOP],
			lastOpened: { [descriptorKey(LAPTOP)]: NOW - 2 * MINUTE },
		});
		const [unopened] = buildSessionRows({ endpoints: [LAPTOP] });
		expect(describeActivity(cloud as never, NOW)).toBe("Updated 2m ago");
		expect(describeActivity(machine as never, NOW)).toBe("Opened 2m ago");
		expect(describeActivity(unopened as never, NOW)).toBeUndefined();
	});
});

describe("retained local activity", () => {
	it("uses live background status and unread state for saved and discovered sessions", () => {
		const saved = { ...LAPTOP, hubSessionId: "local-retained" };
		const key = descriptorKey(saved);
		for (const discovered of [false, true]) {
			const input = {
				endpoints: [saved],
				localSessions: discovered
					? [
							{
								descriptor: LAPTOP,
								sessionId: "local-retained",
								status: "idle",
							},
						]
					: [],
				cloudStatuses: { [key]: "completed" as const },
				unreadCloudSessions: new Set([key]),
			};
			const row = buildSessionRows(input).find((row) => row.key === key);
			expect(row).toMatchObject({
				status: "completed",
				unread: true,
				online: true,
			});
			expect(
				buildSessionRows({ ...input, activeKey: key }).find(
					(row) => row.key === key,
				)?.unread,
			).toBe(false);
		}
	});
});

it.each([
	"suspended",
	"stopped",
	"expired",
	"failed",
	"provisioning",
] as const)("shows workspace %s rather than a cached agent's Running status", (status) => {
	const session = cloudSession({ status });
	const key = descriptorKey({ mode: "cloud", url: session.sandboxUrl });
	const [row] = buildSessionRows({
		endpoints: [],
		cloudSessions: [session],
		activeKey: key,
		activeStatus: "running",
		cloudStatuses: { [key]: "running" },
	});
	expect(row?.status).toBe(status);
	expect(row?.online).toBe(false);
});

it.each([
	"Remote renamed",
	"",
	undefined,
])("reconciles a saved mobile title with the authoritative Cloud title %s", (title) => {
	const session = cloudSession({ title });
	const [row] = buildSessionRows({
		endpoints: [
			{
				mode: "cloud",
				url: session.sandboxUrl,
				remoteSessionId: session.id,
				label: "Old",
				sessionTitle: "Old",
			},
		],
		cloudSessions: [session],
	});
	expect(row.descriptor.sessionTitle).toBe(title || undefined);
	expect(row.descriptor.label).toBe(title || CLOUD_BADGE);
	expect(row.descriptor.sessionTitle || row.descriptor.label).not.toBe("Old");
});
