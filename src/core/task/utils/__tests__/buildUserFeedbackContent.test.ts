import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as formatResponseModule from "@core/prompts/responses"
import * as extractTextModule from "@integrations/misc/extract-text"
import type { ClineContent } from "@shared/messages/content"
import sinon from "sinon"
import { buildUserFeedbackContent } from "../buildUserFeedbackContent"

describe("buildUserFeedbackContent", () => {
	let formatResponseStub: sinon.SinonStub
	let processFilesStub: sinon.SinonStub

	beforeEach(() => {
		// Stub formatResponse.imageBlocks to return predictable test data
		formatResponseStub = sinon.stub(formatResponseModule.formatResponse, "imageBlocks")

		// Stub processFilesIntoText to return predictable test data
		processFilesStub = sinon.stub(extractTextModule, "processFilesIntoText")
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("Text Only", () => {
		it("should wrap text in <feedback> tags", async () => {
			const result = await buildUserFeedbackContent("Please add tests")

			result.should.have.length(1)
			result[0].should.have.property("type", "text")
			result[0].should.have.property("text", "<feedback>\nPlease add tests\n</feedback>")
		})

		it("should handle multiline text", async () => {
			const text = "Line 1\nLine 2\nLine 3"
			const result = await buildUserFeedbackContent(text)

			result.should.have.length(1)
			result[0].should.have.property("type", "text")
			result[0].should.have.property("text", `<feedback>\n${text}\n</feedback>`)
		})

		it("should handle text with special characters", async () => {
			const text = "Fix <component> & test $variable"
			const result = await buildUserFeedbackContent(text)

			result.should.have.length(1)
			result[0].should.have.property("text", `<feedback>\n${text}\n</feedback>`)
		})
	})

	describe("Images Only", () => {
		it("should format single image", async () => {
			const mockImageBlock: ClineContent = {
				type: "image",
				source: {
					type: "base64",
					media_type: "image/png",
					data: "base64data",
				},
			}
			formatResponseStub.returns([mockImageBlock])

			const result = await buildUserFeedbackContent(undefined, ["image1"])

			result.should.have.length(1)
			result[0].should.equal(mockImageBlock)
			sinon.assert.calledOnceWithExactly(formatResponseStub, ["image1"])
		})

		it("should format multiple images", async () => {
			const mockImageBlocks: ClineContent[] = [
				{
					type: "image",
					source: {
						type: "base64",
						media_type: "image/png",
						data: "base64data1",
					},
				},
				{
					type: "image",
					source: {
						type: "base64",
						media_type: "image/jpeg",
						data: "base64data2",
					},
				},
			]
			formatResponseStub.returns(mockImageBlocks)

			const result = await buildUserFeedbackContent(undefined, ["image1", "image2"])

			result.should.have.length(2)
			result.should.deepEqual(mockImageBlocks)
			sinon.assert.calledOnceWithExactly(formatResponseStub, ["image1", "image2"])
		})

		it("should return empty array when images array is empty", async () => {
			const result = await buildUserFeedbackContent(undefined, [])

			result.should.have.length(0)
			formatResponseStub.should.not.be.called()
		})
	})

	describe("Files Only", () => {
		it("should process single file", async () => {
			const fileContent = "File content here"
			processFilesStub.resolves(fileContent)

			const result = await buildUserFeedbackContent(undefined, undefined, ["file1.txt"])

			result.should.have.length(1)
			result[0].should.have.property("type", "text")
			result[0].should.have.property("text", fileContent)
			sinon.assert.calledOnceWithExactly(processFilesStub, ["file1.txt"])
		})

		it("should process multiple files", async () => {
			const fileContent = "Combined file content"
			processFilesStub.resolves(fileContent)

			const result = await buildUserFeedbackContent(undefined, undefined, ["file1.txt", "file2.txt"])

			result.should.have.length(1)
			result[0].should.have.property("text", fileContent)
			sinon.assert.calledOnceWithExactly(processFilesStub, ["file1.txt", "file2.txt"])
		})

		it("should handle empty file content", async () => {
			processFilesStub.resolves("")

			const result = await buildUserFeedbackContent(undefined, undefined, ["empty.txt"])

			result.should.have.length(0) // Should not add empty text block
			processFilesStub.should.be.calledOnce()
		})

		it("should return empty array when files array is empty", async () => {
			const result = await buildUserFeedbackContent(undefined, undefined, [])

			result.should.have.length(0)
			processFilesStub.should.not.be.called()
		})
	})

	describe("Combined Inputs", () => {
		it("should handle text + images", async () => {
			const mockImageBlock: ClineContent = {
				type: "image",
				source: {
					type: "base64",
					media_type: "image/png",
					data: "base64data",
				},
			}
			formatResponseStub.returns([mockImageBlock])

			const result = await buildUserFeedbackContent("Look at this", ["image1"])

			result.should.have.length(2)
			result[0].should.have.property("text", "<feedback>\nLook at this\n</feedback>")
			result[1].should.equal(mockImageBlock)
		})

		it("should handle text + files", async () => {
			processFilesStub.resolves("File content")

			const result = await buildUserFeedbackContent("Check these files", undefined, ["file1.txt"])

			result.should.have.length(2)
			result[0].should.have.property("text", "<feedback>\nCheck these files\n</feedback>")
			result[1].should.have.property("text", "File content")
		})

		it("should handle images + files", async () => {
			const mockImageBlock: ClineContent = {
				type: "image",
				source: {
					type: "base64",
					media_type: "image/png",
					data: "base64data",
				},
			}
			formatResponseStub.returns([mockImageBlock])
			processFilesStub.resolves("File content")

			const result = await buildUserFeedbackContent(undefined, ["image1"], ["file1.txt"])

			result.should.have.length(2)
			result[0].should.equal(mockImageBlock)
			result[1].should.have.property("text", "File content")
		})

		it("should handle text + images + files", async () => {
			const mockImageBlocks: ClineContent[] = [
				{
					type: "image",
					source: {
						type: "base64",
						media_type: "image/png",
						data: "base64data1",
					},
				},
				{
					type: "image",
					source: {
						type: "base64",
						media_type: "image/jpeg",
						data: "base64data2",
					},
				},
			]
			formatResponseStub.returns(mockImageBlocks)
			processFilesStub.resolves("File content")

			const result = await buildUserFeedbackContent("Review all of this", ["image1", "image2"], ["file1.txt", "file2.txt"])

			result.should.have.length(4)
			result[0].should.have.property("text", "<feedback>\nReview all of this\n</feedback>")
			result[1].should.equal(mockImageBlocks[0])
			result[2].should.equal(mockImageBlocks[1])
			result[3].should.have.property("text", "File content")
		})
	})

	describe("Empty and Undefined Inputs", () => {
		it("should return empty array when all inputs are undefined", async () => {
			const result = await buildUserFeedbackContent()

			result.should.have.length(0)
			formatResponseStub.should.not.be.called()
			processFilesStub.should.not.be.called()
		})

		it("should return empty array when all inputs are empty", async () => {
			const result = await buildUserFeedbackContent(undefined, [], [])

			result.should.have.length(0)
			formatResponseStub.should.not.be.called()
			processFilesStub.should.not.be.called()
		})

		it("should handle empty string text", async () => {
			const result = await buildUserFeedbackContent("")

			// Empty string is still truthy for the text check, so it gets wrapped
			result.should.have.length(1)
			result[0].should.have.property("text", "<feedback>\n\n</feedback>")
		})

		it("should skip files that produce empty content", async () => {
			processFilesStub.resolves("")

			const result = await buildUserFeedbackContent("Some text", undefined, ["empty.txt"])

			result.should.have.length(1) // Only text block, no file block
			result[0].should.have.property("text", "<feedback>\nSome text\n</feedback>")
		})
	})

	describe("Consistent Formatting", () => {
		it("should always wrap text with newlines in feedback tags", async () => {
			const samples = [
				"single line",
				"multiple\nlines",
				"trailing newline\n",
				"\nleading newline",
				"\n\nmultiple newlines\n\n",
			]

			for (const sample of samples) {
				const result = await buildUserFeedbackContent(sample)
				result[0].should.have.property("text", `<feedback>\n${sample}\n</feedback>`)
			}
		})

		it("should maintain order: text, images, files", async () => {
			const mockImageBlock: ClineContent = {
				type: "image",
				source: {
					type: "base64",
					media_type: "image/png",
					data: "base64data",
				},
			}
			formatResponseStub.returns([mockImageBlock])
			processFilesStub.resolves("File content")

			const result = await buildUserFeedbackContent("Text", ["image"], ["file"])

			result.should.have.length(3)
			result[0].should.have.property("type", "text")
			result[0].should.have.property("text", "<feedback>\nText\n</feedback>")
			result[1].should.have.property("type", "image")
			result[2].should.have.property("type", "text")
			result[2].should.have.property("text", "File content")
		})
	})

	describe("Async Behavior", () => {
		it("should handle async file processing", async () => {
			processFilesStub.resolves("Async file content")

			const result = await buildUserFeedbackContent(undefined, undefined, ["async-file.txt"])

			result.should.have.length(1)
			result[0].should.have.property("text", "Async file content")
		})

		it("should handle file processing errors gracefully", async () => {
			processFilesStub.rejects(new Error("File processing failed"))

			try {
				await buildUserFeedbackContent(undefined, undefined, ["bad-file.txt"])
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("File processing failed")
			}
		})
	})

	describe("Real-World Scenarios", () => {
		it("should handle post-completion feedback scenario", async () => {
			// User provides feedback after task completion
			const result = await buildUserFeedbackContent("Actually, please add error handling")

			result.should.have.length(1)
			result[0].should.have.property("text", "<feedback>\nActually, please add error handling\n</feedback>")
		})

		it("should handle resume with screenshot", async () => {
			// User resumes task with text and screenshot
			const mockImageBlock: ClineContent = {
				type: "image",
				source: {
					type: "base64",
					media_type: "image/png",
					data: "screenshot-data",
				},
			}
			formatResponseStub.returns([mockImageBlock])

			const result = await buildUserFeedbackContent("Fix this issue shown in the screenshot", ["screenshot.png"])

			result.should.have.length(2)
			result[0].should.have.property("text", "<feedback>\nFix this issue shown in the screenshot\n</feedback>")
			result[1].should.equal(mockImageBlock)
		})

		it("should handle resume with code files", async () => {
			// User resumes with feedback and relevant code files
			processFilesStub.resolves("Code file contents")

			const result = await buildUserFeedbackContent("Please review these files before continuing", undefined, [
				"src/main.ts",
				"src/utils.ts",
			])

			result.should.have.length(2)
			result[0].should.have.property("text", "<feedback>\nPlease review these files before continuing\n</feedback>")
			result[1].should.have.property("text", "Code file contents")
		})
	})
})
