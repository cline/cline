// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { serializeAttachments } from "../hooks/chat-session/attachments";
import { imageAttachmentMediaType } from "./image-attachments";

describe("image attachments", () => {
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
