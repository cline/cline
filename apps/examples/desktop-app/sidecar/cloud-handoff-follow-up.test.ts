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
	const send = vi.spyOn(cloud, "send").mockImplementation(async () => {
		expect(readCloudHandoffFollowUp("cloud-target")).toEqual({
			sourceSessionId: "source",
			command: "edited",
			userImages: images,
			unconfirmed: true,
		});
		if (fails) throw new Error("disconnected");
		return { sessionId: "ses-target", ok: true };
	});
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
				async () => true,
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
		);
	} finally {
		send.mockRestore();
		await disposeSidecarContext(ctx);
	}
});

it("leaves ordinary cloud sends without a recovery copy unchanged", async () => {
	const send = vi.fn(async () => ({ ok: true }));
	await expect(
		sendWithCloudHandoffFollowUp("normal", "hello", [], send),
	).resolves.toEqual({ ok: true });
	expect(send).toHaveBeenCalledOnce();
	expect(readdirSync(dataDir)).toEqual([]);
});
