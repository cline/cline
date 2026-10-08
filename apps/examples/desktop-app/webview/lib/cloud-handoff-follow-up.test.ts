import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "@/hooks/use-toast";
import {
	cloudHandoffFollowUpAttachments,
	openWithCloudHandoffFollowUp,
	restoreCloudHandoffFollowUp,
	shouldPreserveCloudComposer,
} from "./cloud-handoff-follow-up";
import { desktopClient } from "./desktop-client";

vi.mock("./desktop-client", () => ({ desktopClient: { invoke: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
const saved = {
	draftId: "saved-draft",
	sourceSessionId: "local-source",
	command: "inspect this",
	userImages: ["data:image/png;base64,aW1hZ2U="],
};
beforeEach(() => vi.resetAllMocks());

it.each([
	["", 0, undefined, false],
	["edited draft", 0, undefined, true],
	["", 1, undefined, true],
	["", 0, saved.draftId, true],
] as const)("preserves composer text=%j images=%i restored=%s: %s", (prompt, images, restored, preserve) => {
	expect(
		shouldPreserveCloudComposer(prompt, images, restored, saved.draftId),
	).toBe(preserve);
});

it("restores the command and images again after opening without sending", async () => {
	vi.mocked(desktopClient.invoke).mockResolvedValue(saved);
	const open = vi.fn();
	expect(
		await openWithCloudHandoffFollowUp({
			targetSessionId: "cloud-target",
			canOpen: () => true,
			open,
		}),
	).toBe(true);
	const [command, images, draftId] = open.mock.calls[0];
	expect(draftId).toBe(saved.draftId);
	expect(command).toBe(saved.command);
	expect(images[0].type).toBe("image/png");
	expect(await images[0].text()).toBe("image");
	await openWithCloudHandoffFollowUp({
		targetSessionId: "cloud-target",
		canOpen: () => true,
		open,
	});
	expect(open.mock.calls[1][0]).toBe(saved.command);
	expect(await open.mock.calls[1][1][0].text()).toBe("image");
	expect(vi.mocked(desktopClient.invoke).mock.calls).toEqual([
		["get_cloud_handoff_follow_up", { sessionId: "cloud-target" }],
		["get_cloud_handoff_follow_up", { sessionId: "cloud-target" }],
	]);
});

it.each([
	"navigated",
	"open failed",
])("does not consume recovery when %s", async (failure) => {
	vi.mocked(desktopClient.invoke).mockResolvedValue(saved);
	const open = vi.fn(() => {
		throw new Error("open failed");
	});
	const result = openWithCloudHandoffFollowUp({
		targetSessionId: "cloud-target",
		canOpen: () => failure !== "navigated",
		open,
	});
	if (failure === "navigated") await expect(result).resolves.toBe(false);
	else await expect(result).rejects.toThrow("open failed");
	expect(desktopClient.invoke).toHaveBeenCalledTimes(1);
});

it("keeps explicitly supplied draft/files and leaves normal cloud opens unchanged", async () => {
	vi.mocked(desktopClient.invoke).mockResolvedValue(null);
	const open = vi.fn();
	const image = new File(["current"], "current.png", { type: "image/png" });
	await openWithCloudHandoffFollowUp({
		targetSessionId: "cloud-target",
		initialPromptDraft: "current",
		initialAttachments: [image],
		canOpen: () => true,
		open,
	});
	expect(open).toHaveBeenLastCalledWith("current", [image], undefined);
	await openWithCloudHandoffFollowUp({
		targetSessionId: "another-target",
		canOpen: () => true,
		open,
	});
	expect(open).toHaveBeenLastCalledWith(undefined, undefined, undefined);
});

it("does not offer an unconfirmed send for resubmission, even with stale initial props", async () => {
	vi.mocked(desktopClient.invoke).mockResolvedValue({
		...saved,
		unconfirmed: true,
	});
	const open = vi.fn();
	expect(
		await openWithCloudHandoffFollowUp({
			targetSessionId: "cloud-target",
			initialPromptDraft: saved.command,
			initialAttachments: [new File(["image"], "image.png")],
			canOpen: () => true,
			open,
		}),
	).toBe(true);
	expect(open).toHaveBeenCalledExactlyOnceWith(undefined, undefined);
	expect(toast).not.toHaveBeenCalled();
});

it("opens an explicit text-only retry without the older saved images", async () => {
	vi.mocked(desktopClient.invoke).mockResolvedValue(saved);
	const open = vi.fn();
	await openWithCloudHandoffFollowUp({
		targetSessionId: "cloud-target",
		initialPromptDraft: "new text-only retry",
		canOpen: () => true,
		open,
	});
	expect(open).toHaveBeenCalledExactlyOnceWith(
		"new text-only retry",
		undefined,
		saved.draftId,
	);
});

it.each([
	{ command: "newer edit", image: "newer" },
	{ command: saved.command, image: "newer" },
	{ command: saved.command, image: undefined },
	{ command: saved.command, image: "newer", savedImages: ["invalid"] },
])("keeps a newer retry when an older send is unconfirmed: %j", async ({
	command,
	image,
	savedImages,
}) => {
	vi.mocked(desktopClient.invoke).mockResolvedValue({
		...saved,
		userImages: savedImages ?? saved.userImages,
		unconfirmed: true,
	});
	const open = vi.fn();
	const attachments = image
		? [new File([image], "newer.png", { type: "image/png" })]
		: [];
	await openWithCloudHandoffFollowUp({
		targetSessionId: "cloud-target",
		initialPromptDraft: command,
		initialAttachments: attachments,
		canOpen: () => true,
		open,
	});
	expect(open).toHaveBeenCalledOnce();
	expect(open.mock.calls[0][0]).toBe(command);
	expect(open.mock.calls[0][1]).toBe(attachments);
});

it("decodes an explicitly restored uncertain image without mutating the saved copy", async () => {
	const uncertain = { ...saved, unconfirmed: true };
	const images = cloudHandoffFollowUpAttachments(uncertain);
	expect(await images[0].text()).toBe("image");
	expect(images[0].type).toBe("image/png");
	expect(uncertain.unconfirmed).toBe(true);
	expect(() =>
		cloudHandoffFollowUpAttachments({ ...saved, userImages: ["invalid"] }),
	).toThrow("Invalid saved image");
});

it("does not navigate after retry image comparison loses the active thread", async () => {
	vi.mocked(desktopClient.invoke).mockResolvedValue({
		...saved,
		unconfirmed: true,
	});
	const open = vi.fn();
	let active = true;
	const image = new File(["newer"], "newer.png", { type: "image/png" });
	const readImage = image.arrayBuffer.bind(image);
	vi.spyOn(image, "arrayBuffer").mockImplementation(async () => {
		active = false;
		return readImage();
	});
	expect(
		await openWithCloudHandoffFollowUp({
			targetSessionId: "cloud-target",
			initialPromptDraft: saved.command,
			initialAttachments: [image],
			canOpen: () => active,
			open,
		}),
	).toBe(false);
	expect(open).not.toHaveBeenCalled();
});

it.each([
	"restored",
	"existing draft",
	"navigated",
	"changed copy",
])("explicit recovery handles %s without sending", async (outcome) => {
	const expected = { ...saved, unconfirmed: true };
	let canRestore = outcome !== "existing draft";
	vi.mocked(desktopClient.invoke).mockImplementation(async () => {
		if (outcome === "navigated") canRestore = false;
		if (outcome === "changed copy") throw new Error("saved follow-up changed");
		return saved;
	});
	const restore = vi.fn();
	const result = restoreCloudHandoffFollowUp({
		targetSessionId: "target",
		expected,
		canRestore: () => canRestore,
		restore,
	});
	if (outcome === "existing draft" || outcome === "changed copy")
		await expect(result).rejects.toThrow();
	else await result;
	if (outcome === "restored") {
		expect(restore.mock.calls[0][0]).toBe(saved.command);
		expect(restore.mock.calls[0][2]).toBe(saved.draftId);
		expect(await restore.mock.calls[0][1][0].text()).toBe("image");
	} else expect(restore).not.toHaveBeenCalled();
	expect(desktopClient.invoke).toHaveBeenCalledTimes(
		outcome === "existing draft" ? 0 : 1,
	);
	if (outcome !== "existing draft")
		expect(desktopClient.invoke).toHaveBeenCalledWith(
			"restore_cloud_handoff_follow_up",
			{ sessionId: "target", expected },
		);
});

it.each([
	"read failed",
	"invalid image",
])("keeps cloud history openable when recovery has %s", async (failure) => {
	if (failure === "read failed")
		vi.mocked(desktopClient.invoke).mockRejectedValueOnce(
			new Error("read failed"),
		);
	else
		vi.mocked(desktopClient.invoke).mockResolvedValueOnce({
			...saved,
			userImages: ["invalid"],
		});
	const open = vi.fn();
	expect(
		await openWithCloudHandoffFollowUp({
			targetSessionId: "cloud-target",
			canOpen: () => true,
			open,
		}),
	).toBe(true);
	expect(open).toHaveBeenCalledExactlyOnceWith(undefined, undefined, undefined);
	expect(desktopClient.invoke).toHaveBeenCalledTimes(1);
	expect(toast).toHaveBeenCalledWith(
		expect.objectContaining({
			title: "Cloud opened without the saved follow-up",
		}),
	);
});
