import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "@/hooks/use-toast";
import { openWithCloudHandoffFollowUp } from "./cloud-handoff-follow-up";
import { desktopClient } from "./desktop-client";

vi.mock("./desktop-client", () => ({ desktopClient: { invoke: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
const saved = {
	sourceSessionId: "local-source",
	command: "inspect this",
	userImages: ["data:image/png;base64,aW1hZ2U="],
};
beforeEach(() => vi.resetAllMocks());

it("restores a history-open after reload with no source UI state, then consumes recovery", async () => {
	vi.mocked(desktopClient.invoke)
		.mockResolvedValueOnce(saved)
		.mockResolvedValueOnce(true);
	const open = vi.fn();
	const delivered = vi.fn();
	expect(
		await openWithCloudHandoffFollowUp({
			targetSessionId: "cloud-target",
			canOpen: () => true,
			open,
			delivered,
		}),
	).toBe(true);
	const [command, images] = open.mock.calls[0];
	expect(command).toBe(saved.command);
	expect(images[0].type).toBe("image/png");
	expect(await images[0].text()).toBe("image");
	expect(delivered).toHaveBeenCalledExactlyOnceWith(saved.sourceSessionId);
	expect(desktopClient.invoke).toHaveBeenLastCalledWith(
		"clear_cloud_handoff_follow_up",
		{ sessionId: "cloud-target" },
	);
	expect(open.mock.invocationCallOrder[0]).toBeLessThan(
		vi.mocked(desktopClient.invoke).mock.invocationCallOrder[1],
	);
});

it.each([
	"navigated",
	"open failed",
])("does not consume recovery when %s", async (failure) => {
	vi.mocked(desktopClient.invoke).mockResolvedValue(saved);
	const delivered = vi.fn();
	const open = vi.fn(() => {
		throw new Error("open failed");
	});
	const result = openWithCloudHandoffFollowUp({
		targetSessionId: "cloud-target",
		canOpen: () => failure !== "navigated",
		open,
		delivered,
	});
	if (failure === "navigated") await expect(result).resolves.toBe(false);
	else await expect(result).rejects.toThrow("open failed");
	expect(desktopClient.invoke).toHaveBeenCalledTimes(1);
	expect(delivered).not.toHaveBeenCalled();
});

it("keeps explicitly supplied draft/files and leaves normal cloud opens unchanged", async () => {
	vi.mocked(desktopClient.invoke).mockResolvedValue(null);
	const open = vi.fn();
	const delivered = vi.fn();
	const image = new File(["current"], "current.png", { type: "image/png" });
	await openWithCloudHandoffFollowUp({
		targetSessionId: "cloud-target",
		initialPromptDraft: "current",
		initialAttachments: [image],
		canOpen: () => true,
		open,
		delivered,
	});
	expect(open).toHaveBeenLastCalledWith("current", [image]);
	await openWithCloudHandoffFollowUp({
		targetSessionId: "another-target",
		canOpen: () => true,
		open,
		delivered,
	});
	expect(open).toHaveBeenLastCalledWith(undefined, undefined);
	expect(delivered).not.toHaveBeenCalled();
});

it("does not report opening as failed if clearing the delivered backup fails", async () => {
	vi.mocked(desktopClient.invoke)
		.mockResolvedValueOnce(saved)
		.mockRejectedValueOnce(new Error("disk unavailable"));
	expect(
		await openWithCloudHandoffFollowUp({
			targetSessionId: "cloud-target",
			canOpen: () => true,
			open: vi.fn(),
			delivered: vi.fn(),
		}),
	).toBe(true);
	expect(toast).toHaveBeenCalledWith(
		expect.objectContaining({
			title: expect.stringContaining("could not be cleared"),
		}),
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
	const delivered = vi.fn();
	expect(
		await openWithCloudHandoffFollowUp({
			targetSessionId: "cloud-target",
			canOpen: () => true,
			open,
			delivered,
		}),
	).toBe(true);
	expect(open).toHaveBeenCalledExactlyOnceWith(undefined, undefined);
	expect(delivered).not.toHaveBeenCalled();
	expect(desktopClient.invoke).toHaveBeenCalledTimes(1);
	expect(toast).toHaveBeenCalledWith(
		expect.objectContaining({
			title: "Cloud opened without the saved follow-up",
		}),
	);
});
