import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CloudSessionError,
	type CloudSessionEvent,
	type CloudSessionSnapshot,
} from "@cline/core/cloud";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudEligibility } from "./eligibility";
import { CliCloudRuntime, type CliCloudRuntimeOptions } from "./runtime";
import { CloudCreationStore } from "./storage";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0)) await fn();
	vi.unstubAllGlobals();
});
async function fixture(
	enabled = true,
	handoffSource?: CliCloudRuntimeOptions["handoffSource"],
) {
	const root = mkdtempSync(join(tmpdir(), "cloud-runtime-"));
	const store = new CloudCreationStore(join(root, "drafts"));
	let accountId = "a";
	let token = "token";
	let gate = enabled;
	const eligibility = new CloudEligibility({
		createService: () => ({
			poll: async () => {},
			getBooleanFlagEnabled: () => gate,
			getCacheSnapshot: () => ({ updateTime: Date.now(), userId: accountId }),
			dispose: async () => {},
		}),
	});
	let snapshot: CloudSessionSnapshot = {
		sessionId: "ses-one",
		config: {},
		messages: [],
		promptsInQueue: [],
		approvals: [],
		busy: false,
		startedAt: 1,
		status: "idle",
		connectionState: "connected",
		transcriptKnown: true,
	};
	let receive: ((event: CloudSessionEvent) => void) | undefined;
	const controller = {
		list: vi.fn(async () => []),
		listRepositories: vi.fn(),
		listBranches: vi.fn(),
		attach: vi.fn(async () => ({})),
		readMessages: vi.fn(async () => []),
		getSnapshot: vi.fn(() => snapshot),
		send: vi.fn(async () => ({})),
		abort: vi.fn(async () => ({})),
		detach: vi.fn(async () => {}),
		delete: vi.fn(async () => ({})),
		dispose: vi.fn(async () => {}),
		subscribe: vi.fn((listener: (event: CloudSessionEvent) => void) => {
			receive = listener;
			return () => {
				receive = undefined;
			};
		}),
		respondApproval: vi.fn(async () => {}),
		updatePendingPrompt: vi.fn(),
		removePendingPrompt: vi.fn(),
	};
	const api = {
		delete: vi.fn(async () => {}),
		create: vi.fn(async () => ({ sessionId: "ses-one" })),
		recoverCreation: vi.fn(async () => ({ id: "ses-one" })),
	};
	const factory = vi.fn(async () => ({ api, controller }));
	const resolveIdentity = vi.fn(async () =>
		token
			? {
					scope: { apiBaseUrl: "https://example.test", accountId },
					accountLabel: accountId,
					organizationLabel: "Personal",
				}
			: undefined,
	);
	const runtime = new CliCloudRuntime({
		handoffSource,
		eligibility,
		store,
		resolveIdentity,
		getToken: async () => token || undefined,
		createClients:
			factory as unknown as CliCloudRuntimeOptions["createClients"],
	});
	cleanup.push(async () => {
		await runtime.dispose();
		rmSync(root, { recursive: true, force: true });
	});
	await runtime.initialize();
	return {
		runtime,
		api,
		controller,
		factory,
		store,
		resolveIdentity,
		emit: (event: CloudSessionEvent) => receive?.(event),
		setAccount: (next: string) => {
			accountId = next;
		},
		setToken: (next: string) => {
			token = next;
		},
		revokeGate: async () => {
			gate = false;
			await eligibility.setScope((await resolveIdentity())?.scope);
		},
		setGate: (next: boolean) => {
			gate = next;
		},
		setSnapshot: (next: CloudSessionSnapshot) => {
			snapshot = next;
		},
	};
}
const input = {
	repoUrl: "https://github.com/a/b",
	branch: "main",
	modelId: "model",
	prompt: "literal @file /skill",
	autoApproveTools: false,
};
async function until(condition: () => boolean) {
	for (let i = 0; i < 50 && !condition(); i++)
		await new Promise((resolve) => setTimeout(resolve, 0));
	expect(condition()).toBe(true);
}
describe("CLI cloud isolation and creation lifecycle", () => {
	it("does not initialize handoff clients or read local history when PostHog denies access", async () => {
		const source = vi.fn();
		const f = await fixture(false, source);
		await expect(f.runtime.prepareHandoff()).rejects.toThrow();
		expect(f.factory).not.toHaveBeenCalled();
		expect(source).not.toHaveBeenCalled();
	});

	it.each([
		false,
		true,
	])("includes catalog-only models and filters Pass before deduplication for organization=%s", async (organization) => {
		const f = await fixture();
		const identity = (await f.resolveIdentity())!;
		f.resolveIdentity.mockResolvedValue({
			...identity,
			scope: {
				...identity.scope,
				...(organization ? { organizationId: "org" } : {}),
			},
		});
		const fetcher = vi.fn(
			async (url: string) =>
				new Response(
					JSON.stringify(
						url.endsWith("/models")
							? {
									data: [
										{ id: "duplicate", name: "Catalog duplicate" },
										{ id: "catalog-only", name: "Catalog only" },
									],
								}
							: {
									data: {
										clinePass: [
											{ id: "duplicate", name: "Pass duplicate" },
											{ id: "pass-only", name: "Pass only" },
										],
										clineCloud: [{ id: "cloud", name: "Cloud" }],
									},
								},
					),
				),
		);
		vi.stubGlobal("fetch", fetcher);
		const models = await f.runtime.models();
		expect(models.map(({ id, name }) => ({ id, name }))).toEqual(
			organization
				? [
						{ id: "cloud", name: "Cloud" },
						{ id: "duplicate", name: "Catalog duplicate" },
						{ id: "catalog-only", name: "Catalog only" },
					]
				: [
						{ id: "duplicate", name: "Pass duplicate" },
						{ id: "pass-only", name: "Pass only" },
						{ id: "cloud", name: "Cloud" },
						{ id: "catalog-only", name: "Catalog only" },
					],
		);
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			"https://example.test/api/v1/ai/cline/models",
			"https://example.test/api/v1/ai/cline/recommended-models",
		]);
	});

	it("rejects model catalog results after the account changes", async () => {
		const f = await fixture();
		const catalog = deferred<Response>();
		const fetcher = vi.fn(async (url: string) =>
			url.endsWith("/models")
				? await catalog.promise
				: new Response(JSON.stringify({ data: {} })),
		);
		vi.stubGlobal("fetch", fetcher);
		const models = f.runtime.models();
		await until(() => fetcher.mock.calls.length > 0);
		f.runtime.invalidateIdentity();
		f.setAccount("b");
		await f.runtime.refreshIdentity();
		catalog.resolve(
			new Response(JSON.stringify({ data: [{ id: "old-account-model" }] })),
		);
		await expect(models).rejects.toThrow("account or connection changed");
	});

	it("coalesces concurrent account checks for session and repository lists", async () => {
		const f = await fixture();
		const identity = await f.resolveIdentity();
		const lookup = deferred<typeof identity>();
		f.resolveIdentity.mockClear().mockReturnValueOnce(lookup.promise);
		f.controller.listRepositories.mockResolvedValue({
			repositories: [],
			truncated: false,
		});
		const sessions = f.runtime.list();
		const repositories = f.runtime.listRepositories();
		expect(f.resolveIdentity).toHaveBeenCalledOnce();
		lookup.resolve(identity);
		await expect(Promise.all([sessions, repositories])).resolves.toEqual([
			[],
			{ repositories: [], truncated: false },
		]);
		expect(f.factory).toHaveBeenCalledOnce();
	});

	it.each([
		"timer",
		"manual",
	])("coalesces overlapping timer and manual account checks when %s starts first", async (first) => {
		vi.useFakeTimers();
		try {
			const f = await fixture();
			const identity = await f.resolveIdentity();
			const lookup = deferred<typeof identity>();
			f.resolveIdentity.mockClear().mockReturnValueOnce(lookup.promise);
			if (first === "timer") await vi.advanceTimersByTimeAsync(60_000);
			const manual = f.runtime.refreshIdentity();
			if (first === "manual") await vi.advanceTimersByTimeAsync(60_000);
			const sessions = f.runtime.list();
			expect(f.resolveIdentity).toHaveBeenCalledOnce();
			lookup.resolve(identity);
			await expect(manual).resolves.toBeUndefined();
			await expect(sessions).resolves.toEqual([]);
			await f.runtime.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("a superseded identity lookup cannot authorize a creation from stale cached scope", async () => {
		const f = await fixture();
		const identity = await f.resolveIdentity();
		const old = deferred<typeof identity>();
		f.resolveIdentity.mockReturnValueOnce(old.promise);
		const creating = f.runtime.create(input);
		f.runtime.invalidateIdentity();
		f.setAccount("b");
		await f.runtime.refreshIdentity();
		old.resolve(identity);
		await expect(creating).rejects.toThrow("superseded");
		expect(f.api.create).not.toHaveBeenCalled();
	});
	it("attaching an outer sandbox with no saved policy initializes new tools as manual", async () => {
		const f = await fixture();
		await f.runtime.attach("ses-one");
		expect(f.controller.attach).toHaveBeenCalledWith("ses-one", {
			autoApproveTools: false,
		});
	});
	it("a precise server acceptance clears the draft while the first run is still active", async () => {
		const f = await fixture();
		const sent = deferred<object>();
		f.controller.send.mockReturnValueOnce(sent.promise);
		const creating = f.runtime.create(input);
		await until(() => f.controller.send.mock.calls.length > 0);
		f.emit({
			type: "prompt_accepted",
			sessionId: "ses-other",
			prompt: input.prompt,
		});
		expect(f.runtime.getSnapshot().pendingCreations[0].intent).toBe(
			"delivery_unknown",
		);
		f.emit({
			type: "prompt_accepted",
			sessionId: "ses-one",
			prompt: input.prompt,
		});
		expect(f.runtime.getSnapshot().pendingCreations[0].intent).toBe(
			"sent_confirmed",
		);
		expect(f.runtime.getSnapshot().pendingCreations[0].prompt).toBeUndefined();
		f.runtime.detach();
		sent.reject(new Error("viewer detached"));
		await creating;
		expect(f.runtime.getSnapshot().pendingCreations[0].intent).toBe(
			"sent_confirmed",
		);
	});
	it("a transient account lookup preserves the viewer and cannot prevent Stop or approval", async () => {
		const f = await fixture();
		await f.runtime.attach("ses-one");
		f.resolveIdentity.mockRejectedValue(new Error("account API unavailable"));
		await expect(f.runtime.refreshIdentity()).rejects.toThrow(
			"account API unavailable",
		);
		expect(f.runtime.getSnapshot().target?.sessionId).toBe("ses-one");
		await f.runtime.stop();
		await f.runtime.respondApproval("approval", true);
		expect(f.controller.abort).toHaveBeenCalledOnce();
		expect(f.controller.respondApproval).toHaveBeenCalledWith(
			"ses-one",
			"approval",
			{ approved: true },
		);
		expect(f.controller.detach).not.toHaveBeenCalled();
		await expect(f.runtime.create(input)).rejects.toThrow(
			"account API unavailable",
		);
		expect(f.api.create).not.toHaveBeenCalled();
	});
	it("logout immediately revokes active task actions", async () => {
		const f = await fixture();
		await f.runtime.attach("ses-one");
		f.setToken("");
		await expect(f.runtime.stop()).rejects.toThrow("account changed");
		expect(f.controller.abort).not.toHaveBeenCalled();
		expect(f.runtime.getSnapshot().target).toBeUndefined();
	});
	it("leaving while preflight auth waits cannot start or attach a task", async () => {
		const f = await fixture();
		const identity = await f.resolveIdentity();
		const pending = deferred<typeof identity>();
		f.resolveIdentity.mockReturnValueOnce(pending.promise);
		const creating = f.runtime.create(input);
		f.runtime.detach();
		pending.resolve(identity);
		await creating;
		expect(f.api.create).not.toHaveBeenCalled();
		expect(f.controller.attach).not.toHaveBeenCalled();
	});
	it("recovery after leaving does not reopen a task or resend its draft", async () => {
		const f = await fixture();
		f.api.create.mockRejectedValueOnce(new Error("lost POST"));
		await expect(f.runtime.create(input)).rejects.toThrow();
		const row = f.runtime.getSnapshot().pendingCreations[0];
		const found = deferred<{ id: string }>();
		f.api.recoverCreation.mockReturnValue(found.promise);
		const recovery = f.runtime.recover(row.requestId);
		await until(() => f.api.recoverCreation.mock.calls.length > 0);
		f.runtime.detach();
		found.resolve({ id: "ses-one" });
		await recovery;
		expect(f.runtime.getSnapshot().target).toBeUndefined();
		expect(f.controller.send).not.toHaveBeenCalled();
		expect(f.api.create).toHaveBeenCalledOnce();
	});
	it("a detached provisioning request does not prevent a new task", async () => {
		const f = await fixture();
		const post = deferred<{ sessionId: string }>();
		f.api.create.mockReturnValueOnce(post.promise);
		const first = f.runtime.create(input);
		await until(() => f.api.create.mock.calls.length > 0);
		f.runtime.detach();
		await f.runtime.create({ ...input, prompt: "second task" });
		post.resolve({ sessionId: "ses-old" });
		await first;
		expect(f.controller.send).toHaveBeenCalledTimes(1);
		expect(f.controller.send).toHaveBeenCalledWith("ses-one", "second task");
		expect(f.runtime.getSnapshot().target?.sessionId).toBe("ses-one");
	});
	it("explicit cancelled-creation cleanup works after rollout revocation in its original scope only", async () => {
		const f = await fixture();
		await f.runtime.create(input);
		const row = f.runtime.getSnapshot().pendingCreations[0];
		await f.revokeGate();
		await f.runtime.cancelCreation(row.requestId);
		expect(f.api.delete).toHaveBeenCalledWith("ses-one", "token");
		expect(f.runtime.getSnapshot().eligibility.enabled).toBe(false);
	});
	it("late send completion cannot resurrect a cancelled creation record", async () => {
		const f = await fixture();
		const sent = deferred<object>();
		f.controller.send.mockReturnValueOnce(sent.promise);
		const creating = f.runtime.create(input);
		await until(() => f.controller.send.mock.calls.length > 0);
		const row = f.runtime.getSnapshot().pendingCreations[0];
		await f.runtime.cancelCreation(row.requestId);
		sent.resolve({});
		await creating;
		expect(f.runtime.getSnapshot().pendingCreations).toEqual([]);
	});
	it("disabled entry points make zero cloud API or socket clients", async () => {
		const f = await fixture(false);
		await expect(f.runtime.list()).rejects.toThrow("unavailable");
		await expect(f.runtime.create(input)).rejects.toThrow("unavailable");
		expect(f.factory).not.toHaveBeenCalled();
	});
	it("persists before POST and sends literal text with an explicit manual policy", async () => {
		const f = await fixture();
		f.api.create.mockImplementation(async () => {
			expect(f.runtime.getSnapshot().pendingCreations[0]).toMatchObject({
				prompt: input.prompt,
				intent: "start_pending",
				autoApproveTools: false,
			});
			return { sessionId: "ses-one" };
		});
		await f.runtime.create(input);
		expect(f.api.create).toHaveBeenCalledOnce();
		expect(f.controller.attach).toHaveBeenCalledWith("ses-one", {
			autoApproveTools: false,
		});
		expect(f.controller.send).toHaveBeenCalledWith("ses-one", input.prompt);
		expect(f.runtime.getSnapshot().pendingCreations[0].intent).toBe(
			"sent_confirmed",
		);
		expect(f.runtime.getSnapshot().pendingCreations[0].prompt).toBeUndefined();
	});
	it("a late successful POST after detach preserves the draft and never sends or deletes", async () => {
		const f = await fixture();
		const post = deferred<{ sessionId: string }>();
		f.api.create.mockReturnValue(post.promise);
		const creating = f.runtime.create(input);
		await until(() => f.api.create.mock.calls.length > 0);
		f.runtime.detach();
		post.resolve({ sessionId: "ses-late" });
		await creating;
		expect(f.controller.send).not.toHaveBeenCalled();
		expect(f.controller.delete).not.toHaveBeenCalled();
		expect(f.runtime.getSnapshot().pendingCreations[0]).toMatchObject({
			intent: "detached",
			outerSessionId: "ses-late",
			prompt: input.prompt,
		});
	});
	it("cancel records a tombstone before ID exists, then deletes exactly that sandbox", async () => {
		const f = await fixture();
		const post = deferred<{ sessionId: string }>();
		f.api.create.mockReturnValue(post.promise);
		const creating = f.runtime.create(input);
		await until(() => f.api.create.mock.calls.length > 0);
		const id = f.runtime.getSnapshot().pendingCreations[0].requestId;
		await f.runtime.cancelCreation(id);
		expect(f.runtime.getSnapshot().pendingCreations[0].intent).toBe(
			"cancel_requested",
		);
		post.resolve({ sessionId: "ses-cancel" });
		await creating;
		expect(f.api.delete).toHaveBeenCalledWith("ses-cancel", "token");
		expect(f.controller.send).not.toHaveBeenCalled();
		expect(f.runtime.getSnapshot().pendingCreations).toEqual([]);
	});
	it("account ABA retires starts and prevents stale continuations", async () => {
		const f = await fixture();
		const post = deferred<{ sessionId: string }>();
		f.api.create.mockReturnValue(post.promise);
		const creating = f.runtime.create(input);
		await until(() => f.api.create.mock.calls.length > 0);
		f.setAccount("b");
		await f.runtime.refreshIdentity();
		f.setAccount("a");
		await f.runtime.refreshIdentity();
		post.resolve({ sessionId: "ses-stale" });
		await creating;
		expect(f.controller.send).not.toHaveBeenCalled();
		expect(f.controller.delete).not.toHaveBeenCalled();
		expect(f.runtime.getSnapshot().pendingCreations[0].intent).toBe("detached");
	});
	it("drops definitely rejected creates but retains ambiguous outcomes", async () => {
		const rejected = await fixture();
		rejected.api.create.mockRejectedValueOnce(
			new CloudSessionError(
				"authentication_required",
				"Sign in again.",
				undefined,
				401,
			),
		);
		await expect(rejected.runtime.create(input)).rejects.toThrow(
			"Sign in again",
		);
		expect(rejected.runtime.getSnapshot().pendingCreations).toEqual([]);

		const ambiguous = await fixture();
		ambiguous.api.create.mockRejectedValueOnce(
			new CloudSessionError(
				"request_failed",
				"Gateway unavailable.",
				undefined,
				500,
			),
		);
		await expect(ambiguous.runtime.create(input)).rejects.toThrow(
			"Gateway unavailable",
		);
		expect(ambiguous.runtime.getSnapshot().pendingCreations).toMatchObject([
			{ intent: "detached", prompt: input.prompt },
		]);
	});
	it("lost send acknowledgement never automatically retries on recover", async () => {
		const f = await fixture();
		f.controller.send.mockRejectedValue(new Error("lost reply"));
		await expect(f.runtime.create(input)).rejects.toThrow("lost reply");
		const row = f.runtime.getSnapshot().pendingCreations[0];
		expect(row.intent).toBe("delivery_unknown");
		await f.runtime.recover(row.requestId);
		expect(f.controller.send).toHaveBeenCalledOnce();
		await expect(f.runtime.resumeDraft(row.requestId)).rejects.toThrow(
			"duplicate risk",
		);
		expect(f.controller.send).toHaveBeenCalledOnce();
		expect(f.api.create).toHaveBeenCalledOnce();
	});
	it("rollout revocation detaches without stopping or deleting and disables all new operations", async () => {
		const f = await fixture();
		await f.runtime.attach("ses-one");
		await f.revokeGate();
		expect(f.controller.detach).toHaveBeenCalledWith("ses-one");
		expect(f.controller.abort).not.toHaveBeenCalled();
		expect(f.controller.delete).not.toHaveBeenCalled();
		await expect(f.runtime.send("hello")).rejects.toThrow();
	});
	it("Stop is single-flight and detach never rejects a pending remote approval", async () => {
		const f = await fixture();
		await f.runtime.attach("ses-one");
		const abort = deferred<object>();
		f.controller.abort.mockReturnValue(abort.promise);
		const first = f.runtime.stop();
		const second = f.runtime.stop();
		expect(first).toBe(second);
		expect(f.runtime.getSnapshot().stopping).toBe(true);
		await until(() => f.controller.abort.mock.calls.length > 0);
		f.runtime.detach();
		abort.resolve({});
		await first;
		expect(f.controller.abort).toHaveBeenCalledOnce();
		expect(f.controller.respondApproval).not.toHaveBeenCalled();
	});
});
