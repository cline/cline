import { describe, expect, it } from "vitest"
import { shouldProcessImageAttachments } from "./imageAttachments"

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
