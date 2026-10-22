// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { serializeAttachments } from "../hooks/chat-session/attachments";
import { usePendingAttachments } from "../hooks/use-pending-attachments";
import {
	cloudImageAttachmentError,
	imageAttachmentMediaType,
	isSupportedImageAttachment,
	isUnsupportedImageAttachment,
} from "./image-attachments";

describe("image attachments", () => {
	it("preserves new attachments when an older send restores its draft", async () => {
		let draft!: ReturnType<typeof usePendingAttachments>;
		function Harness() {
			draft = usePendingAttachments();
			return null;
		}
		const root = createRoot(document.createElement("div"));
		const original = new File(["a"], "a.png");
		const added = new File(["b"], "b.png");
		try {
			await act(async () =>
				root.render(createElement(StrictMode, null, createElement(Harness))),
			);
			await act(async () => draft[1]([original]));
			const [sent, update] = draft;
			await act(async () => update([]));
			await act(async () => draft[1]([added]));
			const restore = vi.fn((current: File[]) => [...current, ...sent]);
			await act(async () => update(restore));
			expect(draft[0]).toEqual([added, original]);
			expect(restore).toHaveBeenCalledOnce();
			await act(async () => {
				update([]);
				update((current) => [...current, original]);
				update((current) => [...current, added]);
			});
			expect(draft[0]).toEqual([original, added]);
		} finally {
			await act(async () => root.unmount());
		}
	});
	it.each([
		[[3_932_160], undefined],
		[[3_932_161], "Each image"],
		[[3_145_728, 3_145_728], undefined],
		[[3_145_728, 3_145_729], "in total"],
		[[1, 1, 1, 1, 1], undefined],
		[[1, 1, 1, 1, 1, 1], "up to 5"],
	] as const)("checks cloud image budgets for %j", (sizes, error) => {
		const result = cloudImageAttachmentError(sizes.map((size) => ({ size })));
		if (error) expect(result).toContain(error);
		else expect(result).toBeUndefined();
	});
	it.each([
		["photo.png", "image/png", true],
		["photo.jfif", "", true],
		["photo.webp", "application/octet-stream", true],
		["photo.heic", "", false],
		["diagram.svg", "image/svg+xml", false],
		["notes.txt", "text/plain", false],
	])("validates cloud image attachment %s (%s)", (name, type, expected) => {
		expect(isSupportedImageAttachment({ name, type })).toBe(expected);
	});

	it.each([
		"photo.jfif",
		"photo.JPE",
		"photo.jpg",
	])("serializes %s with a JPEG MIME type", async (name) => {
		const file = new File(["jpeg data"], name, {
			type: "application/octet-stream",
		});
		expect(imageAttachmentMediaType(file)).toBe("image/jpeg");
		const result = await serializeAttachments([file]);
		expect(result.userFiles).toEqual([]);
		expect(result.userImages[0]).toMatch(/^data:image\/jpeg;base64,/);
	});
	it("leaves non-images as files and honors image MIME types", () => {
		expect(
			imageAttachmentMediaType({ name: "notes.txt", type: "text/plain" }),
		).toBeUndefined();
		expect(
			imageAttachmentMediaType({ name: "capture", type: "image/png" }),
		).toBe("image/png");
	});
});

it.each([
	"bmp",
	"svg",
	"heic",
	"heif",
	"avif",
	"tiff",
	"ico",
])("identifies unsupported %s images for the attachment checkpoint", async (extension) => {
	const file = new File(["image data"], `photo.${extension}`);
	expect(isUnsupportedImageAttachment(file)).toBe(true);
});
