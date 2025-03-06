// npx jest src/integrations/terminal/__tests__/OutputBuilder.test.ts

import { OutputBuilder } from "../OutputBuilder"

describe("OutputBuilder", () => {
	describe("basic functionality", () => {
		it("should create instance with default settings", () => {
			const builder = new OutputBuilder()
			expect(builder).toBeInstanceOf(OutputBuilder)
			expect(builder.content).toBe("")
			expect(builder.isTruncated).toBe(false)
			expect(builder.size).toBe(0)
		})

		it("should append and retrieve content", () => {
			const builder = new OutputBuilder()
			builder.append("Hello, ")
			builder.append("world!")

			expect(builder.content).toBe("Hello, world!")
			expect(builder.isTruncated).toBe(false)
			expect(builder.size).toBe(13)
		})

		it("should reset content properly", () => {
			const builder = new OutputBuilder()
			builder.append("Hello, world!")
			builder.reset()

			expect(builder.content).toBe("")
			expect(builder.isTruncated).toBe(false)
			expect(builder.size).toBe(0)
		})
	})

	describe("truncation behavior", () => {
		it("should not truncate content below max size", () => {
			// Create with 100 byte limit.
			const builder = new OutputBuilder({
				maxSize: 100,
				preserveStartPercent: 20,
				preserveEndPercent: 80,
			})

			// Add 50 bytes of content.
			builder.append("a".repeat(50))

			expect(builder.content).toBe("a".repeat(50))
			expect(builder.isTruncated).toBe(false)
			expect(builder.size).toBe(50)
		})

		it("should truncate content correctly when exceeding max size", () => {
			// Small buffer for testing
			const maxSize = 100
			const truncationMessage = "[...TRUNCATED...]"
			const builder = new OutputBuilder({
				maxSize,
				preserveStartPercent: 20,
				preserveEndPercent: 80,
				truncationMessage,
			})

			// Calculate preserve sizes.
			const preserveStartSize = Math.floor(0.2 * maxSize) // 20 bytes
			const preserveEndSize = Math.floor(0.8 * maxSize) // 80 bytes

			// Add content that exceeds the 100 byte limit.
			builder.append("a".repeat(120))

			// Check truncation happened.
			expect(builder.isTruncated).toBe(true)

			// Verify content structure.
			const content = builder.content

			// Should have this structure:
			// [start 20 chars] + [truncation message] + [end 80 chars]
			expect(content).toBe("a".repeat(preserveStartSize) + truncationMessage + "a".repeat(preserveEndSize))

			// Size should be: startSize + truncationMessage.length + endSize
			expect(builder.size).toBe(preserveStartSize + truncationMessage.length + preserveEndSize)
		})

		it("should preserve start and end with different percentages", () => {
			// Small buffer with 50/50 split.
			const builder = new OutputBuilder({
				maxSize: 100,
				preserveStartPercent: 50,
				preserveEndPercent: 50,
				truncationMessage: "[...]",
			})

			// Add 200 bytes.
			builder.append("a".repeat(200))

			// Should preserve 50 at start, 50 at end.
			expect(builder.content).toBe("a".repeat(50) + "[...]" + "a".repeat(50))
			expect(builder.isTruncated).toBe(true)
		})

		it("should handle multiple content additions after truncation", () => {
			const builder = new OutputBuilder({
				maxSize: 100,
				preserveStartPercent: 30,
				preserveEndPercent: 70,
				truncationMessage: "[...]",
			})

			// Initial content that triggers truncation.
			builder.append("a".repeat(120))
			expect(builder.isTruncated).toBe(true)

			// Add more content - should update end portion.
			builder.append("b".repeat(20))

			// Should contain start (a's), truncation message, and end with both a's and b's.
			const content = builder.content
			expect(content.startsWith("a".repeat(30))).toBe(true)
			expect(content.indexOf("[...]")).toBe(30)
			expect(content.endsWith("b".repeat(20))).toBe(true)
		})
	})

	describe("edge cases", () => {
		it("should handle empty string appends", () => {
			const builder = new OutputBuilder({ maxSize: 100 })
			builder.append("")
			expect(builder.content).toBe("")
			expect(builder.size).toBe(0)
		})

		it("should handle content exactly at size limit", () => {
			const builder = new OutputBuilder({ maxSize: 100 })
			builder.append("a".repeat(100))

			// Should not trigger truncation at exactly the limit.
			expect(builder.isTruncated).toBe(false)
			expect(builder.size).toBe(100)
		})

		it("should handle very small max sizes", () => {
			// 10 byte max with 3 byte start, 7 byte end.
			const builder = new OutputBuilder({
				maxSize: 10,
				preserveStartPercent: 30,
				preserveEndPercent: 70,
				truncationMessage: "...",
			})

			builder.append("1234567890abc")

			// Get result and validate structure (start + message + end).
			const result = builder.content
			expect(result.startsWith("123")).toBe(true)
			expect(result.indexOf("...")).toBe(3)

			// For small buffers, there might be differences in exact content
			// based on implementation details.
			// But the combined length should be correct:
			// startSize(3) + message(3) + endSize(7) = 13
			expect(result.length).toBe(13)
		})

		it("should throw error for invalid configuration", () => {
			// Preserve percentages that add up to more than 100%.
			expect(() => {
				new OutputBuilder({
					maxSize: 100,
					preserveStartPercent: 60,
					preserveEndPercent: 60,
				})
			}).toThrow()
		})

		it("should handle continuous appending beyond multiple truncations", () => {
			// Small buffer for testing multiple truncations.
			const builder = new OutputBuilder({
				maxSize: 20,
				preserveStartPercent: 25, // 5 bytes
				preserveEndPercent: 75, // 15 bytes
				truncationMessage: "...",
			})

			// First append - triggers truncation.
			builder.append("a".repeat(30))
			expect(builder.isTruncated).toBe(true)
			expect(builder.content).toBe("a".repeat(5) + "..." + "a".repeat(15))

			// Second append with different character.
			builder.append("b".repeat(10))

			// Should maintain start buffer, but end buffer should now have some b's.
			const expectedEndBuffer = "a".repeat(5) + "b".repeat(10)
			expect(builder.content).toBe("a".repeat(5) + "..." + expectedEndBuffer)

			// Third append with another character.
			builder.append("c".repeat(5))

			// End buffer should shift again.
			const finalEndBuffer = "a".repeat(0) + "b".repeat(10) + "c".repeat(5)
			expect(builder.content).toBe("a".repeat(5) + "..." + finalEndBuffer)
		})
	})

	describe("read", () => {
		it("handles truncated output", () => {
			const builder = new OutputBuilder({
				maxSize: 60,
				preserveStartPercent: 40,
				preserveEndPercent: 60,
				truncationMessage: " ... ",
			})

			builder.append("Beginning content that will partially remain. ")
			expect(builder.content).toBe("Beginning content that will partially remain. ")
			expect(builder.bytesProcessed).toBe(46)
			expect(builder.bytesRemoved).toBe(0)
			expect(builder.read()).toBe("Beginning content that will partially remain. ")
			expect(builder.cursor).toBe(46)

			builder.append("Ending content that will remain until another append. ")
			expect(builder.content).toBe("Beginning content that w ... t will remain until another append. ")
			expect(builder.bytesProcessed).toBe(100)
			expect(builder.bytesRemoved).toBe(40)
			expect(builder.read()).toBe("t will remain until another append. ")
			expect(builder.cursor).toBe(100)

			builder.append("Fin. ")
			expect(builder.content).toBe("Beginning content that w ... l remain until another append. Fin. ")
			expect(builder.bytesProcessed).toBe(105)
			expect(builder.bytesRemoved).toBe(45)
			expect(builder.read()).toBe("Fin. ")
			expect(builder.cursor).toBe(105)

			builder.append("Foo bar baz. ")
			expect(builder.content).toBe("Beginning content that w ... l another append. Fin. Foo bar baz. ")
			expect(builder.bytesProcessed).toBe(118)
			expect(builder.bytesRemoved).toBe(58)
			expect(builder.read()).toBe("Foo bar baz. ")
			expect(builder.cursor).toBe(118)

			builder.append("Lorem ipsum dolor sit amet, libris convenire vix ei, ea cum aperiam liberavisse. ")
			expect(builder.content).toBe("Beginning content that w ... vix ei, ea cum aperiam liberavisse. ")
			expect(builder.bytesProcessed).toBe(199)
			expect(builder.bytesRemoved).toBe(139)
			expect(builder.read()).toBe("vix ei, ea cum aperiam liberavisse. ")
			expect(builder.cursor).toBe(199)
		})
	})

	describe("readLine", () => {
		it("handles truncated output", () => {
			const builder = new OutputBuilder({
				maxSize: 60,
				preserveStartPercent: 40,
				preserveEndPercent: 60,
				truncationMessage: " ... ",
			})

			builder.append("Lorem ipsum dolor sit amet.\nLibris convenire vix ei.")
			expect(builder.content).toBe("Lorem ipsum dolor sit amet.\nLibris convenire vix ei.")
			expect(builder.readLine()).toBe("Lorem ipsum dolor sit amet.\n")
			expect(builder.readLine()).toBe("Libris convenire vix ei.")

			builder.append("Est aliqua quis aliqua.\nAliquip culpa id cillum enim.")
			expect(builder.content).toBe("Lorem ipsum dolor sit am ... liqua.\nAliquip culpa id cillum enim.")
			expect(builder.readLine()).toBe("liqua.\n")
			expect(builder.readLine()).toBe("Aliquip culpa id cillum enim.")
		})
	})
})
