import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	CloudSessionEvent,
	CreateCloudSessionInput,
} from "@cline/core/cloud";
import type { HubEventEnvelope } from "@cline/shared";
import {
	type DeviceCloudController,
	DeviceCloudSessions,
	resolveCloudRepository,
} from "./cloud";

function fixture() {
	const listeners = new Set<(event: CloudSessionEvent) => void>();
	const approvals: unknown[] = [];
	const creations: CreateCloudSessionInput[] = [];
	const emit = (event: CloudSessionEvent) => {
		for (const listener of listeners) listener(event);
	};
	let rejectSend!: (reason: Error) => void;
	const controller: DeviceCloudController = {
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		create: async (input) => {
			creations.push(input);
			return { sessionId: "ses-cloud", status: "ready" };
		},
		listModels: async () => [
			{ id: "model", name: "Model", catalogId: "cline-cloud" },
		],
		send: (sessionId, prompt) => {
			const pending = new Promise<never>((_, reject) => {
				rejectSend = reject;
			});
			queueMicrotask(() =>
				emit({ type: "prompt_accepted", sessionId, prompt }),
			);
			return pending;
		},
		abort: async () => ({ sessionId: "ses-cloud", ok: true }),
		respondApproval: async (...args) => {
			approvals.push(args);
		},
		dispose: async () => {},
	};
	const cloud = new DeviceCloudSessions(controller, () => {});
	return {
		cloud,
		emit,
		approvals,
		creations,
		reject: (error: Error) => rejectSend(error),
	};
}

describe("device cloud sessions", () => {
	it("returns on acceptance before the turn completes and projects later errors", async () => {
		const { cloud, reject } = fixture();
		const events: unknown[] = [];
		cloud.subscribe((event) => events.push(event));
		await cloud.send("ses-cloud", "fix the build");
		reject(new Error("turn failed"));
		await Promise.resolve();
		expect(events).toContainEqual(
			expect.objectContaining({
				event: "run.failed",
				sessionId: "ses-cloud",
				payload: { error: "turn failed" },
			}),
		);
		await cloud.dispose();
	});

	it("keeps cloud paths out of local workspace selection and routes compact approval IDs", async () => {
		const { cloud, emit, approvals } = fixture();
		const events: HubEventEnvelope[] = [];
		cloud.subscribe((event) => events.push(event));
		emit({
			type: "hub_event",
			sessionId: "ses-cloud",
			event: {
				version: "v1",
				event: "session.updated",
				sessionId: "ses-cloud",
				payload: { session: { cwd: "/workspace/cloud" } },
			} as HubEventEnvelope,
		});
		expect(events).toHaveLength(0);
		const snapshot = {
			type: "snapshot",
			sessionId: "ses-cloud",
			replace: false,
			snapshot: {
				busy: true,
				status: "running",
				approvals: [
					{
						approvalId: "a".repeat(80),
						sessionId: "ses-cloud",
						toolName: "bash",
						input: { command: "ls" },
					},
				],
			},
		} as unknown as CloudSessionEvent;
		emit(snapshot);
		emit(snapshot);
		const requested = events.filter(
			(event) => event.event === "approval.requested",
		);
		expect(requested).toHaveLength(1);
		const id = String(requested[0].payload?.approvalId);
		expect(id.length).toBeLessThan(72);
		expect(cloud.hasApproval(id)).toBe(true);
		await cloud.respondApproval(id, true);
		expect(approvals).toEqual([
			["ses-cloud", "a".repeat(80), { approved: true }],
		]);
		emit({
			...snapshot,
			snapshot: { busy: true, status: "running", approvals: [] },
		} as unknown as CloudSessionEvent);
		expect(cloud.hasApproval(id)).toBe(false);
		expect(events.at(-1)?.event).toBe("approval.resolved");
		await cloud.dispose();
	});

	it("resolves the pushed upstream repository without leaking URL credentials", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "device-cloud-"));
		const git = (...args: string[]) =>
			execFileSync("git", args, { cwd, stdio: "pipe" });
		try {
			git("init", "-b", "local");
			git(
				"remote",
				"add",
				"origin",
				"https://token@github.com/cline/cline.git",
			);
			git("config", "branch.local.remote", "origin");
			git("config", "branch.local.merge", "refs/heads/pushed");
			expect(await resolveCloudRepository(cwd)).toEqual({
				repoUrl: "https://github.com/cline/cline",
				branch: "pushed",
				workspaceRelativePath: undefined,
			});
			const { cloud, creations } = fixture();
			try {
				expect(await cloud.start("fix the build", cwd)).toBe("ses-cloud");
				expect(creations).toEqual([
					expect.objectContaining({
						repoUrl: "https://github.com/cline/cline",
						branch: "pushed",
						mode: "yolo",
						autoApproveTools: true,
						modelId: "model",
						initialPrompt: "fix the build",
					}),
				]);
			} finally {
				await cloud.dispose();
			}
			git("remote", "set-url", "origin", "https://secret@example.com/repo.git");
			await expect(resolveCloudRepository(cwd)).rejects.toThrow(
				"Cloud session needs a GitHub repository and a pushed branch",
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
