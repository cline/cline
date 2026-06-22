import { describe, expect, it } from "vitest"
import { isAcceptedImageType, shouldProcessImageAttachments } from "./imageAttachments"

describe("shouldProcessImageAttachments", () => {
	it("rejects images when the selected model does not support images", () => {
		expect(
			shouldProcessImageAttachments({
				supportsImages: false,
				shouldDisableFilesAndImages: false,
				imageCount: 1,
			}),
		).toBe(false)
	})

	it("accepts images when the selected model supports images and attachment slots remain", () => {
		expect(
			shouldProcessImageAttachments({
				supportsImages: true,
				shouldDisableFilesAndImages: false,
				imageCount: 1,
			}),
		).toBe(true)
	})

	it("rejects image handling when there are no images or attachment slots are full", () => {
		expect(
			shouldProcessImageAttachments({
				supportsImages: true,
				shouldDisableFilesAndImages: false,
				imageCount: 0,
			}),
		).toBe(false)
		expect(
			shouldProcessImageAttachments({
				supportsImages: true,
				shouldDisableFilesAndImages: true,
				imageCount: 1,
			}),
		).toBe(false)
	})
})

describe("isAcceptedImageType", () => {
	it("accepts image MIME types supported by the attachment pipeline", () => {
		expect(isAcceptedImageType("image/png")).toBe(true)
		expect(isAcceptedImageType("image/jpeg")).toBe(true)
		expect(isAcceptedImageType("image/webp")).toBe(true)
	})

	it("rejects unsupported image MIME types and non-image files", () => {
		expect(isAcceptedImageType("image/gif")).toBe(false)
		expect(isAcceptedImageType("text/plain")).toBe(false)
		expect(isAcceptedImageType("")).toBe(false)
	})
})
