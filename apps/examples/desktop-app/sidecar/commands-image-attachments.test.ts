import { describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import type { SidecarContext } from "./types";

describe("image attachment telemetry", () => {
	it("only captures the source and count, excluding extra payload fields", async () => {
		const capture = vi.fn();
		const ctx = { telemetry: { capture } } as unknown as SidecarContext;
		await handleCommand(ctx, "record_image_attachment_blocked", {
			source: "paste",
			imageCount: 2,
			filename: "private.png",
			content: "secret",
		});
		expect(capture).toHaveBeenCalledWith({
			event: "desktop.image_attachment_blocked",
			properties: { source: "paste", imageCount: 2 },
		});
	});
	it.each([
		{ source: "private text", imageCount: 1 },
		{ source: "send", imageCount: -1 },
		{ source: "picker", imageCount: 1.5 },
	])("rejects invalid telemetry %j", async (args) => {
		const capture = vi.fn();
		const ctx = { telemetry: { capture } } as unknown as SidecarContext;
		await expect(
			handleCommand(ctx, "record_image_attachment_blocked", args),
		).rejects.toThrow("Invalid image attachment telemetry");
		expect(capture).not.toHaveBeenCalled();
	});
});
