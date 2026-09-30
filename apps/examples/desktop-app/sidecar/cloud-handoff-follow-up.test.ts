import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleChatSessionCommand } from "./chat-session";
import {
	clearCloudHandoffFollowUp,
	readCloudHandoffFollowUp,
	saveCloudHandoffFollowUp,
	sendWithCloudHandoffFollowUp,
	updateCloudHandoffFollowUp,
} from "./cloud-handoff-follow-up";
import { CloudSessionApi, CloudSessionManager } from "./cloud-sessions";
import { createSidecarContext, disposeSidecarContext } from "./context";

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
])("does not clear a different %s payload", async (difference) => {
	const saved = {
		sourceSessionId: "source",
		command: "inspect",
		userImages: ["image"],
		unconfirmed: true,
	};
	saveCloudHandoffFollowUp("target", saved);
	const replacement = { ...saved, sourceSessionId: "new-source" };
	await sendWithCloudHandoffFollowUp(
		"target",
		difference === "command" ? "other" : saved.command,
		difference === "images" ? [] : saved.userImages,
		async (lifecycle) => {
			if (difference === "source")
				saveCloudHandoffFollowUp("target", replacement);
			lifecycle?.onAccepted?.();
			return { ok: true };
		},
	);
	expect(readCloudHandoffFollowUp("target")).toEqual(
		difference === "source" ? replacement : saved,
	);
});

it("restores or dismisses only the reviewed recovery copy", () => {
	const saved = {
		sourceSessionId: "source",
		command: "inspect",
		userImages: ["image"],
		unconfirmed: true,
	};
	saveCloudHandoffFollowUp("target", saved);
	const restored = updateCloudHandoffFollowUp("target", saved, "restore");
	expect(restored).toEqual({
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
		sourceSessionId: "source",
		command: "original",
		userImages: [],
	});
	const images = ["data:image/png;base64,aW1hZ2U="];
	await expect(
		sendWithCloudHandoffFollowUp("target", "edited", images, async () => {
			throw new Error("preflight failed");
		}),
	).rejects.toThrow("preflight failed");
	expect(readCloudHandoffFollowUp("target")).toEqual({
		sourceSessionId: "source",
		command: "edited",
		userImages: images,
	});
});

it("leaves ordinary cloud sends without a recovery copy unchanged", async () => {
	const send = vi.fn(async () => ({ ok: true as const }));
	await expect(
		sendWithCloudHandoffFollowUp("normal", "hello", [], send),
	).resolves.toEqual({ ok: true });
	expect(send).toHaveBeenCalledOnce();
	expect(readdirSync(dataDir)).toEqual([]);
});
