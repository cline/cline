import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeHubClient } from "@cline/core";
import { HubServerTransport } from "@cline/core/hub";
import type { HubEventEnvelope } from "@cline/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleChatSessionCommand } from "./chat-session";
import {
	type CloudHandoffFollowUp,
	clearCloudHandoffFollowUp,
	readCloudHandoffFollowUp,
	saveCloudHandoffFollowUp,
	sendWithCloudHandoffFollowUp,
	updateCloudHandoffFollowUp,
} from "./cloud-handoff-follow-up";
import { CloudSessionApi, CloudSessionManager } from "./cloud-sessions";
import { createSidecarContext, disposeSidecarContext } from "./context";
import { localRuntimeContext } from "./session-test-helpers";

let dataDir: string;
beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-handoff-follow-up-"));
	vi.stubEnv("CLINE_DATA_DIR", dataDir);
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(dataDir, { recursive: true, force: true });
});

it("persists the command and image bytes independently of process state until acknowledged", () => {
	const saved = {
		draftId: "draft",
		sourceSessionId: "local-source",
		command: "inspect this",
		userImages: ["data:image/png;base64,aW1hZ2U="],
	};
	saveCloudHandoffFollowUp("cloud-target", saved);
	const directory = join(dataDir, "desktop-handoff-follow-ups");
	const files = readdirSync(directory);
	expect(files).toHaveLength(1);
	expect(JSON.parse(readFileSync(join(directory, files[0]), "utf8"))).toEqual(
		saved,
	);
	if (process.platform !== "win32")
		expect(statSync(join(directory, files[0])).mode & 0o777).toBe(0o600);
	expect(readCloudHandoffFollowUp("cloud-target")).toEqual(saved);
	expect(readCloudHandoffFollowUp("another-target")).toBeNull();
	clearCloudHandoffFollowUp("cloud-target");
	clearCloudHandoffFollowUp("cloud-target");
	expect(readCloudHandoffFollowUp("cloud-target")).toBeNull();
});

it("keeps untrusted session ids inside the recovery directory", () => {
	saveCloudHandoffFollowUp("../../outside", {
		sourceSessionId: "source",
		command: "hello",
		userImages: [],
	});
	expect(readdirSync(dataDir)).toEqual(["desktop-handoff-follow-ups"]);
	expect(readCloudHandoffFollowUp("../../outside")?.command).toBe("hello");
});

it.each([
	false,
	true,
])("retains the submitted payload until confirmed (send fails: %s)", async (fails) => {
	const ctx = createSidecarContext("/workspace");
	Object.assign(
		ctx,
		localRuntimeContext({
			get: vi.fn(async () => ({
				metadata: {
					handoff: {
						status: "complete",
						toCloudSessionId: "cloud-target",
						handedOffAt: "2026-09-30T00:00:00.000Z",
					},
				},
			})),
		}),
	);
	const options = {
		apiBaseUrl: "https://api.example",
		appBaseUrl: "https://app.example",
		getAuthToken: async () => "synthetic-token",
	};
	const cloud = new CloudSessionManager(ctx, {
		...options,
		api: new CloudSessionApi(options),
	});
	ctx.cloudSessionManager = cloud;
	saveCloudHandoffFollowUp("cloud-target", {
		draftId: "draft",
		sourceSessionId: "source",
		command: "original",
		userImages: [],
	});
	const images = ["data:image/png;base64,aW1hZ2U="];
	const send = vi
		.spyOn(cloud, "send")
		.mockImplementation(
			async (_id, _prompt, _delivery, _model, _images, lifecycle) => {
				lifecycle?.beforeDispatch?.();
				expect(readCloudHandoffFollowUp("cloud-target")).toEqual({
					draftId: "draft",
					sourceSessionId: "source",
					command: "edited",
					userImages: images,
					unconfirmed: true,
				});
				if (fails) throw new Error("disconnected");
				return { sessionId: "ses-target", ok: true };
			},
		);
	const sending = handleChatSessionCommand(ctx, {
		action: "send",
		sessionId: "cloud-target",
		prompt: "edited",
		handoffFollowUpId: "draft",
		attachments: { userImages: images },
		config: { executionTarget: "cloud" },
	});
	try {
		if (fails) {
			await expect(sending).rejects.toThrow("disconnected");
			expect(readCloudHandoffFollowUp("cloud-target")).toMatchObject({
				command: "edited",
				userImages: images,
				unconfirmed: true,
			});
			await sendWithCloudHandoffFollowUp(
				"cloud-target",
				"another message",
				[],
				async () => ({ ok: true }),
			);
			expect(readCloudHandoffFollowUp("cloud-target")?.command).toBe("edited");
		} else {
			await expect(sending).resolves.toMatchObject({ ok: true });
			expect(readCloudHandoffFollowUp("cloud-target")).toBeNull();
		}
		expect(send).toHaveBeenCalledExactlyOnceWith(
			"cloud-target",
			"edited",
			undefined,
			undefined,
			images,
			expect.objectContaining({
				beforeDispatch: expect.any(Function),
				onAccepted: expect.any(Function),
			}),
		);
	} finally {
		send.mockRestore();
		ctx.runtimeBindings.clear();
		await disposeSidecarContext(ctx);
	}
});

it.each([
	"before dispatch",
	"uncertain",
	"accepted then disconnected",
	"successful retry",
	"text-only reconciliation",
])("handles recovery after %s", async (outcome) => {
	const saved = {
		draftId: "draft",
		sourceSessionId: "source",
		command: "inspect",
		userImages: ["data:image/png;base64,aW1hZ2U="],
	};
	saveCloudHandoffFollowUp("target", saved);
	await expect(
		sendWithCloudHandoffFollowUp(
			"target",
			saved.command,
			saved.userImages,
			async (lifecycle) => {
				if (outcome !== "before dispatch") lifecycle?.beforeDispatch?.();
				if (outcome === "accepted then disconnected") lifecycle?.onAccepted?.();
				throw new Error("send failed");
			},
		),
	).rejects.toThrow("send failed");
	if (
		outcome === "successful retry" ||
		outcome === "text-only reconciliation"
	) {
		await sendWithCloudHandoffFollowUp(
			"target",
			saved.command,
			saved.userImages,
			async (lifecycle) => {
				lifecycle?.beforeDispatch?.();
				return {
					ok: true,
					recoveredAfterDisconnect: outcome === "text-only reconciliation",
				};
			},
		);
	}
	expect(readCloudHandoffFollowUp("target")).toEqual(
		outcome === "accepted then disconnected" || outcome === "successful retry"
			? null
			: outcome === "before dispatch"
				? saved
				: { ...saved, unconfirmed: true },
	);
});

it.each([
	"command",
	"images",
	"source",
	"draftId",
])("does not clear a different %s payload", async (difference) => {
	const saved = {
		draftId: "draft",
		sourceSessionId: "source",
		command: "inspect",
		userImages: ["image"],
		unconfirmed: true,
	};
	saveCloudHandoffFollowUp("target", saved);
	const replacement = {
		...saved,
		...(difference === "draftId"
			? { draftId: "new-draft" }
			: { sourceSessionId: "new-source" }),
	};
	await sendWithCloudHandoffFollowUp(
		"target",
		difference === "command" ? "other" : saved.command,
		difference === "images" ? [] : saved.userImages,
		async (lifecycle) => {
			if (difference === "source" || difference === "draftId")
				saveCloudHandoffFollowUp("target", replacement);
			lifecycle?.onAccepted?.();
			return { ok: true };
		},
	);
	expect(readCloudHandoffFollowUp("target")).toEqual(
		difference === "source" || difference === "draftId" ? replacement : saved,
	);
});

it("restores or dismisses only the reviewed recovery copy", () => {
	const saved = {
		draftId: "draft",
		sourceSessionId: "source",
		command: "inspect",
		userImages: ["image"],
		unconfirmed: true,
	};
	saveCloudHandoffFollowUp("target", saved);
	const restored = updateCloudHandoffFollowUp("target", saved, "restore");
	expect(restored).toEqual({
		draftId: "draft",
		sourceSessionId: "source",
		command: "inspect",
		userImages: ["image"],
	});
	expect(readCloudHandoffFollowUp("target")).toEqual(restored);
	expect(() => updateCloudHandoffFollowUp("target", saved, "dismiss")).toThrow(
		"changed",
	);
	expect(readCloudHandoffFollowUp("target")).toEqual(restored);
	if (!restored) throw new Error("Missing restored payload");
	updateCloudHandoffFollowUp("target", restored, "dismiss");
	expect(readCloudHandoffFollowUp("target")).toBeNull();
});

it("retains edits and images as a usable draft when preflight rejects", async () => {
	saveCloudHandoffFollowUp("target", {
		draftId: "draft",
		sourceSessionId: "source",
		command: "original",
		userImages: [],
	});
	const images = ["data:image/png;base64,aW1hZ2U="];
	await expect(
		sendWithCloudHandoffFollowUp(
			"target",
			"edited",
			images,
			async () => {
				throw new Error("preflight failed");
			},
			"draft",
		),
	).rejects.toThrow("preflight failed");
	expect(readCloudHandoffFollowUp("target")).toEqual({
		draftId: "draft",
		sourceSessionId: "source",
		command: "edited",
		userImages: images,
	});
});

it.each([
	"accepted",
	"failed",
	"stale draft",
])("preserves an unseen unqueued draft during an unrelated send (%s)", async (outcome) => {
	const saved = {
		draftId: "draft",
		sourceSessionId: "source",
		command: "unseen draft",
		userImages: ["image"],
	};
	saveCloudHandoffFollowUp("target", saved);
	const sending = sendWithCloudHandoffFollowUp(
		"target",
		"unrelated",
		[],
		async (lifecycle) => {
			lifecycle?.beforeDispatch?.();
			if (outcome === "failed") throw new Error("disconnected");
			lifecycle?.onAccepted?.();
			return { ok: true };
		},
		outcome === "stale draft" ? "older-draft" : undefined,
	);
	if (outcome === "failed")
		await expect(sending).rejects.toThrow("disconnected");
	else await sending;
	expect(readCloudHandoffFollowUp("target")).toEqual(saved);
});

it("preserves A recovery while an edited B dispatches during A pending", async () => {
	const saved = {
		draftId: "draft",
		sourceSessionId: "source",
		command: "A",
		userImages: ["a-image"],
	};
	saveCloudHandoffFollowUp("target", saved);
	let releaseA!: () => void;
	const gateA = new Promise<void>((resolve) => (releaseA = resolve));
	const sendA = sendWithCloudHandoffFollowUp(
		"target",
		"A",
		saved.userImages,
		async (lifecycle) => {
			await gateA;
			lifecycle?.beforeDispatch?.();
			throw new Error("A transport failure");
		},
		saved.draftId,
	);
	await Promise.resolve();
	for (const action of ["restore", "dismiss"] as const) {
		expect(() => updateCloudHandoffFollowUp("target", saved, action)).toThrow(
			"Wait for the follow-up send to finish",
		);
		expect(readCloudHandoffFollowUp("target")).toEqual(saved);
	}
	// B is an edited dispatch reusing the restored draft identity. It must not
	// overwrite A's pending recovery, even though it is allowed to dispatch.
	const sendB = sendWithCloudHandoffFollowUp(
		"target",
		"B",
		["b-image"],
		async () => ({ ok: true as const }),
		saved.draftId,
	);
	await expect(sendB).resolves.toMatchObject({ ok: true });
	releaseA();
	await expect(sendA).rejects.toThrow("A transport failure");
	expect(readCloudHandoffFollowUp("target")).toEqual({
		...saved,
		unconfirmed: true,
	});
	expect(
		updateCloudHandoffFollowUp(
			"target",
			{ ...saved, unconfirmed: true },
			"restore",
		),
	).toEqual(saved);
});

it.each([
	false,
	true,
])("tracks a matching concurrent send after the first send fails preflight (uncertain: %s)", async (uncertain) => {
	const saved = {
		draftId: "draft",
		sourceSessionId: "source",
		command: "inspect",
		userImages: ["image"],
	};
	saveCloudHandoffFollowUp("target", saved);
	let finishA!: () => void;
	let finishB!: () => void;
	const gateA = new Promise<void>((resolve) => (finishA = resolve));
	const gateB = new Promise<void>((resolve) => (finishB = resolve));
	const sendA = sendWithCloudHandoffFollowUp(
		"target",
		saved.command,
		saved.userImages,
		async () => {
			await gateA;
			throw new Error("preflight rejected");
		},
	);
	const sendB = sendWithCloudHandoffFollowUp(
		"target",
		saved.command,
		saved.userImages,
		async (lifecycle) => {
			lifecycle?.beforeDispatch?.();
			await gateB;
			if (uncertain) throw new Error("disconnected");
			lifecycle?.onAccepted?.();
			return { ok: true };
		},
	);
	try {
		finishA();
		await expect(sendA).rejects.toThrow("preflight rejected");
		const pending = { ...saved, unconfirmed: true };
		expect(readCloudHandoffFollowUp("target")).toEqual(pending);
		for (const action of ["restore", "dismiss"] as const)
			expect(() =>
				updateCloudHandoffFollowUp("target", pending, action),
			).toThrow("Wait for the follow-up send to finish");
	} finally {
		finishB();
		if (uncertain) await expect(sendB).rejects.toThrow("disconnected");
		else await expect(sendB).resolves.toMatchObject({ ok: true });
	}
	expect(readCloudHandoffFollowUp("target")).toEqual(
		uncertain ? { ...saved, unconfirmed: true } : null,
	);
});

it("leaves ordinary cloud sends without a recovery copy unchanged", async () => {
	const send = vi.fn(async () => ({ ok: true as const }));
	await expect(
		sendWithCloudHandoffFollowUp("normal", "hello", [], send),
	).resolves.toEqual({ ok: true });
	expect(send).toHaveBeenCalledOnce();
	expect(readdirSync(dataDir)).toEqual([]);
});

it.each([
	false,
	true,
])("retains recovery until the actual Hub handler acknowledges admission (rejected: %s)", async (rejected) => {
	const ctx = createSidecarContext("/workspace");
	const options = {
		apiBaseUrl: "https://api.example",
		appBaseUrl: "https://app.example",
		getAuthToken: async () => "synthetic-token",
	};
	const api = new CloudSessionApi(options);
	vi.spyOn(api, "list").mockResolvedValue([
		{
			id: "cloud-target",
			status: "ready",
			sandboxUrl: "",
			title: "test",
			repoContext: {},
			metadata: { taskId: "inner", modelId: "model" },
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01",
		},
	]);
	const session = {
		sessionId: "inner",
		status: "idle",
		metadata: { model: "model" },
	};
	const messages: Array<{ role: "user"; content: string }> = [];
	const saved = {
		draftId: "draft",
		sourceSessionId: "source",
		command: "inspect this",
		userImages: ["data:image/png;base64,aW1hZ2U="],
	};
	let recoveryAtAdmission: CloudHandoffFollowUp | null = null;
	const runTurn = vi.fn(
		async (input: { prompt: string; userImages?: string[] }) => {
			recoveryAtAdmission = readCloudHandoffFollowUp("cloud-target");
			expect(input.userImages).toEqual(saved.userImages);
			if (rejected) throw new Error("Runtime admission rejected");
			messages.push({ role: "user", content: input.prompt });
		},
	);
	const transport = new HubServerTransport({
		sessionHost: {
			getSession: async () => session,
			runTurn,
			subscribe: vi.fn(),
			dispose: vi.fn(),
		} as never,
		runtimeHandlers: {
			startSession: vi.fn(),
			sendSession: vi.fn(),
			abortSession: vi.fn(),
			stopSession: vi.fn(),
		},
		sessionSearchOptions: { dbPath: ":memory:" },
		scheduleOptions: { dbPath: ":memory:" },
		taskOptions: { dbPath: ":memory:", watchFiles: false },
	});
	const cloud = new CloudSessionManager(ctx, {
		...options,
		api,
		createHubClient: () =>
			({
				connect: async () => {},
				dispose: async () => {},
				getClientId: () => "viewer",
				subscribe: (callback: (event: HubEventEnvelope) => void) =>
					transport.subscribe("viewer", callback),
				command: async (
					name: string,
					payload: Record<string, unknown>,
					sessionId: string,
					dispatch?: Parameters<NodeHubClient["command"]>[3],
				) => {
					if (name !== "session.send_input")
						return {
							version: "v1",
							ok: true,
							payload: { session, messages, prompts: [] },
						};
					dispatch?.beforeDispatch?.();
					dispatch?.onDispatch?.("input-request");
					return await transport.handleCommand({
						version: "v1",
						command: name,
						payload,
						sessionId,
						requestId: "input-request",
						clientId: "viewer",
					});
				},
			}) as NodeHubClient,
	});
	ctx.cloudSessionManager = cloud;
	try {
		await cloud.attach("cloud-target");
		await cloud.readMessages("cloud-target");
		saveCloudHandoffFollowUp("cloud-target", saved);
		const sending = sendWithCloudHandoffFollowUp(
			"cloud-target",
			saved.command,
			saved.userImages,
			(lifecycle) =>
				cloud.send(
					"cloud-target",
					saved.command,
					undefined,
					undefined,
					saved.userImages,
					lifecycle,
				),
		);
		if (rejected) {
			await expect(sending).rejects.toThrow("Runtime admission rejected");
			expect(messages).toEqual([]);
			expect(cloud.getSnapshot("cloud-target")?.messages).toEqual([]);
			expect(readCloudHandoffFollowUp("cloud-target")).toEqual({
				...saved,
				unconfirmed: true,
			});
		} else {
			await expect(sending).resolves.toMatchObject({ ok: true });
			expect(messages).toEqual([{ role: "user", content: saved.command }]);
			expect(readCloudHandoffFollowUp("cloud-target")).toBeNull();
		}
		expect(runTurn).toHaveBeenCalledOnce();
		expect(recoveryAtAdmission).toEqual({ ...saved, unconfirmed: true });
	} finally {
		await disposeSidecarContext(ctx);
		await transport.stop();
	}
});
