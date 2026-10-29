// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { serializeAttachments } from "../hooks/chat-session/attachments";
import {
	cloudImageAttachmentError,
	imageAttachmentMediaType,
	isSupportedImageAttachment,
	isUnsupportedImageAttachment,
} from "./image-attachments";

describe("image attachments", () => {
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
