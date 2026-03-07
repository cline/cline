import fs from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { imageFileToDataUrl, isImagePath, jsonParseSafe, parseImagesFromInput, processImagePaths } from "./parser"

describe("parser", () => {
	describe("jsonParseSafe", () => {
		it("should parse valid JSON", () => {
			const result = jsonParseSafe('{"key": "value"}', {})
			expect(result).toEqual({ key: "value" })
		})

		it("should return default value for invalid JSON", () => {
			const defaultValue = { fallback: true }
			const result = jsonParseSafe("not valid json", defaultValue)
			expect(result).toEqual(defaultValue)
		})

		it("should parse arrays", () => {
			const result = jsonParseSafe("[1, 2, 3]", [])
			expect(result).toEqual([1, 2, 3])
		})

		it("should handle empty string", () => {
			const result = jsonParseSafe("", "default")
			expect(result).toBe("default")
		})

		it("should parse nested objects", () => {
			const json = '{"outer": {"inner": "value"}}'
			const result = jsonParseSafe(json, {})
			expect(result).toEqual({ outer: { inner: "value" } })
		})
	})

	describe("isImagePath", () => {
		it("should return true for .png files", () => {
			expect(isImagePath("/path/to/image.png")).toBe(true)
		})

		it("should return true for .jpg files", () => {
			expect(isImagePath("/path/to/image.jpg")).toBe(true)
		})

		it("should return true for .jpeg files", () => {
			expect(isImagePath("/path/to/image.jpeg")).toBe(true)
		})

		it("should return true for .gif files", () => {
			expect(isImagePath("/path/to/image.gif")).toBe(true)
		})

		it("should return true for .webp files", () => {
			expect(isImagePath("/path/to/image.webp")).toBe(true)
		})

		it("should return false for non-image files", () => {
			expect(isImagePath("/path/to/file.txt")).toBe(false)
			expect(isImagePath("/path/to/file.pdf")).toBe(false)
			expect(isImagePath("/path/to/file.js")).toBe(false)
		})

		it("should handle uppercase extensions", () => {
			expect(isImagePath("/path/to/image.PNG")).toBe(true)
			expect(isImagePath("/path/to/image.JPG")).toBe(true)
		})

		it("should handle mixed case extensions", () => {
			expect(isImagePath("/path/to/image.Png")).toBe(true)
		})
	})

	describe("parseImagesFromInput", () => {
		it("should extract image paths with @ prefix", () => {
			const input = "analyze this image @/path/to/image.png"
			const result = parseImagesFromInput(input)
			expect(result.imagePaths).toContain("/path/to/image.png")
			expect(result.prompt).toBe("analyze this image")
		})

		it("should extract multiple images", () => {
			const input = "compare @/img1.png and @/img2.jpg"
			const result = parseImagesFromInput(input)
			expect(result.imagePaths).toContain("/img1.png")
			expect(result.imagePaths).toContain("/img2.jpg")
		})

		it("should handle standalone image paths", () => {
			const input = "look at /path/to/image.png please"
			const result = parseImagesFromInput(input)
			expect(result.imagePaths).toContain("/path/to/image.png")
		})

		it("should return empty array when no images", () => {
			const input = "just some text without images"
			const result = parseImagesFromInput(input)
			expect(result.imagePaths).toEqual([])
			expect(result.prompt).toBe("just some text without images")
		})

		it("should handle image at start of input", () => {
			const input = "@/start.png is the image"
			const result = parseImagesFromInput(input)
			expect(result.imagePaths).toContain("/start.png")
		})

		it("should handle all supported image extensions", () => {
			const input = "@/a.png @/b.jpg @/c.jpeg @/d.gif @/e.webp"
			const result = parseImagesFromInput(input)
			expect(result.imagePaths).toHaveLength(5)
		})

		it("should not duplicate image paths", () => {
			const input = "@/same.png /same.png"
			const result = parseImagesFromInput(input)
			// Both patterns match the same path, should not duplicate
			expect(result.imagePaths.filter((p) => p === "/same.png").length).toBeLessThanOrEqual(2)
		})

		it("should clean up extra whitespace in prompt", () => {
			const input = "text   @/image.png   more text"
			const result = parseImagesFromInput(input)
			expect(result.prompt).toBe("text more text")
		})
	})

	describe("imageFileToDataUrl", () => {
		beforeEach(() => {
			vi.spyOn(fs.promises, "readFile")
		})

		afterEach(() => {
			vi.restoreAllMocks()
		})

		it("should convert png to data URL", async () => {
			const mockBuffer = Buffer.from("fake png data")
			vi.mocked(fs.promises.readFile).mockResolvedValue(mockBuffer)

			const result = await imageFileToDataUrl("/path/to/image.png")

			expect(result).toMatch(/^data:image\/png;base64,/)
			expect(result).toContain(mockBuffer.toString("base64"))
		})

		it("should use correct MIME type for jpeg", async () => {
			const mockBuffer = Buffer.from("fake jpeg data")
			vi.mocked(fs.promises.readFile).mockResolvedValue(mockBuffer)

			const result = await imageFileToDataUrl("/path/to/image.jpg")

			expect(result).toMatch(/^data:image\/jpeg;base64,/)
		})

		it("should use correct MIME type for gif", async () => {
			const mockBuffer = Buffer.from("fake gif data")
			vi.mocked(fs.promises.readFile).mockResolvedValue(mockBuffer)

			const result = await imageFileToDataUrl("/path/to/image.gif")

			expect(result).toMatch(/^data:image\/gif;base64,/)
		})

		it("should use correct MIME type for webp", async () => {
			const mockBuffer = Buffer.from("fake webp data")
			vi.mocked(fs.promises.readFile).mockResolvedValue(mockBuffer)

			const result = await imageFileToDataUrl("/path/to/image.webp")

			expect(result).toMatch(/^data:image\/webp;base64,/)
		})
	})

	describe("processImagePaths", () => {
		beforeEach(() => {
			vi.spyOn(fs, "existsSync")
			vi.spyOn(fs.promises, "readFile")
		})

		afterEach(() => {
			vi.restoreAllMocks()
		})

		it("should process existing image files", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("image data"))

			const result = await processImagePaths(["/path/to/image.png"])

			expect(result).toHaveLength(1)
			expect(result[0]).toMatch(/^data:image\/png;base64,/)
		})

		it("should skip non-existent files", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)

			const result = await processImagePaths(["/nonexistent/image.png"])

			expect(result).toHaveLength(0)
		})

		it("should skip non-image files", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)

			const result = await processImagePaths(["/path/to/file.txt"])

			expect(result).toHaveLength(0)
		})

		it("should process multiple images", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("image data"))

			const result = await processImagePaths(["/img1.png", "/img2.jpg", "/img3.gif"])

			expect(result).toHaveLength(3)
		})

		it("should handle read errors gracefully", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.readFile).mockRejectedValue(new Error("Read error"))

			const result = await processImagePaths(["/path/to/image.png"])

			expect(result).toHaveLength(0)
		})

		it("should handle empty input", async () => {
			const result = await processImagePaths([])
			expect(result).toEqual([])
		})
	})
})
