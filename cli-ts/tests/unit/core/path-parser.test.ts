import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import {
	fileToBase64DataUrl,
	isImageFile,
	parseAtPaths,
	processExplicitFiles,
	processExplicitImages,
} from "../../../src/core/path-parser.js"

describe("path-parser", () => {
	// Create a temp directory for test files
	let tempDir: string

	before(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "path-parser-test-"))
	})

	after(() => {
		// Clean up temp directory
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	describe("isImageFile", () => {
		it("should return true for supported image extensions", () => {
			expect(isImageFile("test.png")).to.be.true
			expect(isImageFile("test.jpg")).to.be.true
			expect(isImageFile("test.jpeg")).to.be.true
			expect(isImageFile("test.gif")).to.be.true
			expect(isImageFile("test.webp")).to.be.true
		})

		it("should return true for uppercase extensions", () => {
			expect(isImageFile("test.PNG")).to.be.true
			expect(isImageFile("test.JPG")).to.be.true
			expect(isImageFile("test.JPEG")).to.be.true
		})

		it("should return false for non-image extensions", () => {
			expect(isImageFile("test.txt")).to.be.false
			expect(isImageFile("test.js")).to.be.false
			expect(isImageFile("test.ts")).to.be.false
			expect(isImageFile("test.pdf")).to.be.false
			expect(isImageFile("test")).to.be.false
		})

		it("should handle paths with directories", () => {
			expect(isImageFile("/path/to/image.png")).to.be.true
			expect(isImageFile("./relative/path/image.jpg")).to.be.true
			expect(isImageFile("/path/to/file.txt")).to.be.false
		})
	})

	describe("fileToBase64DataUrl", () => {
		it("should convert a PNG file to base64 data URL", () => {
			// Create a minimal valid PNG file (1x1 transparent pixel)
			const pngData = Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
				0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
				0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
				0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
			])

			const pngPath = path.join(tempDir, "test.png")
			fs.writeFileSync(pngPath, pngData)

			const result = fileToBase64DataUrl(pngPath)

			expect(result).to.match(/^data:image\/png;base64,/)
			expect(result).to.include(pngData.toString("base64"))
		})

		it("should throw error for non-existent file", () => {
			expect(() => fileToBase64DataUrl("/non/existent/file.png")).to.throw("Image file not found")
		})

		it("should throw error for unsupported format", () => {
			const txtPath = path.join(tempDir, "test.txt")
			fs.writeFileSync(txtPath, "hello")

			expect(() => fileToBase64DataUrl(txtPath)).to.throw("Unsupported image format")
		})

		it("should use correct MIME type for different formats", () => {
			const jpgPath = path.join(tempDir, "test.jpg")
			fs.writeFileSync(jpgPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0])) // Minimal JPEG header

			const result = fileToBase64DataUrl(jpgPath)
			expect(result).to.match(/^data:image\/jpeg;base64,/)
		})
	})

	describe("parseAtPaths", () => {
		beforeEach(() => {
			// Create test files
			fs.writeFileSync(path.join(tempDir, "file1.txt"), "content1")
			fs.writeFileSync(path.join(tempDir, "file2.js"), "content2")
			// Create a minimal PNG for image testing
			const pngData = Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
				0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
				0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
				0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
			])
			fs.writeFileSync(path.join(tempDir, "image.png"), pngData)
		})

		it("should parse single @path at start of message", () => {
			const result = parseAtPaths("@file1.txt check this file", tempDir)

			expect(result.cleanedMessage).to.equal("check this file")
			expect(result.files).to.have.lengthOf(1)
			expect(result.files[0]).to.equal(path.join(tempDir, "file1.txt"))
			expect(result.images).to.have.lengthOf(0)
			expect(result.warnings).to.have.lengthOf(0)
		})

		it("should parse single @path in middle of message", () => {
			const result = parseAtPaths("please check @file1.txt and report", tempDir)

			expect(result.cleanedMessage).to.equal("please check and report")
			expect(result.files).to.have.lengthOf(1)
		})

		it("should parse multiple @paths", () => {
			const result = parseAtPaths("check @file1.txt and @file2.js", tempDir)

			expect(result.cleanedMessage).to.equal("check and")
			expect(result.files).to.have.lengthOf(2)
		})

		it("should separate images from files", () => {
			const result = parseAtPaths("look at @image.png and @file1.txt", tempDir)

			expect(result.files).to.have.lengthOf(1)
			expect(result.files[0]).to.equal(path.join(tempDir, "file1.txt"))
			expect(result.images).to.have.lengthOf(1)
			expect(result.images[0]).to.match(/^data:image\/png;base64,/)
		})

		it("should handle relative paths with ./", () => {
			const result = parseAtPaths("check @./file1.txt", tempDir)

			expect(result.files).to.have.lengthOf(1)
			expect(result.files[0]).to.equal(path.join(tempDir, "file1.txt"))
		})

		it("should handle absolute paths", () => {
			const absolutePath = path.join(tempDir, "file1.txt")
			const result = parseAtPaths(`check @${absolutePath}`, "/some/other/cwd")

			expect(result.files).to.have.lengthOf(1)
			expect(result.files[0]).to.equal(absolutePath)
		})

		it("should warn about non-existent files", () => {
			const result = parseAtPaths("check @nonexistent.txt", tempDir)

			expect(result.files).to.have.lengthOf(0)
			expect(result.warnings).to.have.lengthOf(1)
			expect(result.warnings[0]).to.include("File not found")
		})

		it("should warn about directories", () => {
			fs.mkdirSync(path.join(tempDir, "subdir"), { recursive: true })
			const result = parseAtPaths("check @subdir", tempDir)

			expect(result.files).to.have.lengthOf(0)
			expect(result.warnings).to.have.lengthOf(1)
			expect(result.warnings[0]).to.include("Cannot attach directory")
		})

		it("should not match @ in email addresses", () => {
			const result = parseAtPaths("send to user@example.com", tempDir)

			// The regex requires whitespace before @, so email should not be matched
			expect(result.cleanedMessage).to.equal("send to user@example.com")
			expect(result.files).to.have.lengthOf(0)
		})

		it("should handle message with no @paths", () => {
			const result = parseAtPaths("just a regular message", tempDir)

			expect(result.cleanedMessage).to.equal("just a regular message")
			expect(result.files).to.have.lengthOf(0)
			expect(result.images).to.have.lengthOf(0)
			expect(result.warnings).to.have.lengthOf(0)
		})

		it("should handle empty message", () => {
			const result = parseAtPaths("", tempDir)

			expect(result.cleanedMessage).to.equal("")
			expect(result.files).to.have.lengthOf(0)
		})
	})

	describe("processExplicitFiles", () => {
		beforeEach(() => {
			fs.writeFileSync(path.join(tempDir, "explicit.txt"), "content")
			const pngData = Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
				0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
				0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
				0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
			])
			fs.writeFileSync(path.join(tempDir, "explicit.png"), pngData)
		})

		it("should process regular files", () => {
			const result = processExplicitFiles(["explicit.txt"], tempDir)

			expect(result.files).to.have.lengthOf(1)
			expect(result.files[0]).to.equal(path.join(tempDir, "explicit.txt"))
			expect(result.images).to.have.lengthOf(0)
		})

		it("should auto-detect images and convert to base64", () => {
			const result = processExplicitFiles(["explicit.png"], tempDir)

			expect(result.files).to.have.lengthOf(0)
			expect(result.images).to.have.lengthOf(1)
			expect(result.images[0]).to.match(/^data:image\/png;base64,/)
		})

		it("should throw error for non-existent file (strict mode)", () => {
			expect(() => processExplicitFiles(["nonexistent.txt"], tempDir)).to.throw("File not found")
		})

		it("should throw error for directories", () => {
			fs.mkdirSync(path.join(tempDir, "explicitdir"), { recursive: true })
			expect(() => processExplicitFiles(["explicitdir"], tempDir)).to.throw("Cannot attach directory")
		})

		it("should process multiple files", () => {
			const result = processExplicitFiles(["explicit.txt", "explicit.png"], tempDir)

			expect(result.files).to.have.lengthOf(1)
			expect(result.images).to.have.lengthOf(1)
		})
	})

	describe("processExplicitImages", () => {
		beforeEach(() => {
			const pngData = Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
				0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
				0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
				0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
			])
			fs.writeFileSync(path.join(tempDir, "image2.png"), pngData)
			fs.writeFileSync(path.join(tempDir, "notimage.txt"), "text")
		})

		it("should process image files", () => {
			const result = processExplicitImages(["image2.png"], tempDir)

			expect(result).to.have.lengthOf(1)
			expect(result[0]).to.match(/^data:image\/png;base64,/)
		})

		it("should throw error for non-image files", () => {
			expect(() => processExplicitImages(["notimage.txt"], tempDir)).to.throw("Not a supported image format")
		})

		it("should throw error for non-existent file", () => {
			expect(() => processExplicitImages(["nonexistent.png"], tempDir)).to.throw("Image file not found")
		})

		it("should process multiple images", () => {
			const pngData = Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
				0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
				0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
				0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
			])
			fs.writeFileSync(path.join(tempDir, "image3.png"), pngData)

			const result = processExplicitImages(["image2.png", "image3.png"], tempDir)
			expect(result).to.have.lengthOf(2)
		})
	})
})
