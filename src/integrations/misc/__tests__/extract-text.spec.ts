import { describe, it, expect } from "vitest"
import {
	addLineNumbers,
	everyLineHasLineNumbers,
	stripLineNumbers,
	truncateOutput,
	applyRunLengthEncoding,
	processCarriageReturns,
	processBackspaces,
} from "../extract-text"

describe("addLineNumbers", () => {
	it("should add line numbers starting from 1 by default", () => {
		const input = "line 1\nline 2\nline 3"
		const expected = "1 | line 1\n2 | line 2\n3 | line 3\n"
		expect(addLineNumbers(input)).toBe(expected)
	})

	it("should add line numbers starting from specified line number", () => {
		const input = "line 1\nline 2\nline 3"
		const expected = "10 | line 1\n11 | line 2\n12 | line 3\n"
		expect(addLineNumbers(input, 10)).toBe(expected)
	})

	it("should handle empty content", () => {
		expect(addLineNumbers("")).toBe("")
		expect(addLineNumbers("", 5)).toBe("5 | \n")
	})

	it("should handle single line content", () => {
		expect(addLineNumbers("single line")).toBe("1 | single line\n")
		expect(addLineNumbers("single line", 42)).toBe("42 | single line\n")
	})

	it("should pad line numbers based on the highest line number", () => {
		const input = "line 1\nline 2"
		// When starting from 99, highest line will be 100, so needs 3 spaces padding
		const expected = " 99 | line 1\n100 | line 2\n"
		expect(addLineNumbers(input, 99)).toBe(expected)
	})

	it("should preserve trailing newline without adding extra line numbers", () => {
		const input = "line 1\nline 2\n"
		const expected = "1 | line 1\n2 | line 2\n"
		expect(addLineNumbers(input)).toBe(expected)
	})

	it("should handle multiple blank lines correctly", () => {
		const input = "line 1\n\n\n\nline 2"
		const expected = "1 | line 1\n2 | \n3 | \n4 | \n5 | line 2\n"
		expect(addLineNumbers(input)).toBe(expected)
	})

	it("should handle multiple trailing newlines correctly", () => {
		const input = "line 1\nline 2\n\n\n"
		const expected = "1 | line 1\n2 | line 2\n3 | \n4 | \n"
		expect(addLineNumbers(input)).toBe(expected)
	})

	it("should handle numbered trailing newline correctly", () => {
		const input = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\n\n"
		const expected =
			" 1 | Line 1\n 2 | Line 2\n 3 | Line 3\n 4 | Line 4\n 5 | Line 5\n 6 | Line 6\n 7 | Line 7\n 8 | Line 8\n 9 | Line 9\n10 | Line 10\n11 | \n"
		expect(addLineNumbers(input)).toBe(expected)
	})

	it("should handle only blank lines with offset correctly", () => {
		const input = "\n\n\n"
		const expected = "10 | \n11 | \n12 | \n"
		expect(addLineNumbers(input, 10)).toBe(expected)
	})
})

describe("everyLineHasLineNumbers", () => {
	it("should return true for content with line numbers", () => {
		const input = "1 | line one\n2 | line two\n3 | line three"
		expect(everyLineHasLineNumbers(input)).toBe(true)
	})

	it("should return true for content with padded line numbers", () => {
		const input = "  1 | line one\n  2 | line two\n  3 | line three"
		expect(everyLineHasLineNumbers(input)).toBe(true)
	})

	it("should return false for content without line numbers", () => {
		const input = "line one\nline two\nline three"
		expect(everyLineHasLineNumbers(input)).toBe(false)
	})

	it("should return false for mixed content", () => {
		const input = "1 | line one\nline two\n3 | line three"
		expect(everyLineHasLineNumbers(input)).toBe(false)
	})

	it("should handle empty content", () => {
		expect(everyLineHasLineNumbers("")).toBe(false)
	})

	it("should return false for content with pipe but no line numbers", () => {
		const input = "a | b\nc | d"
		expect(everyLineHasLineNumbers(input)).toBe(false)
	})
})

describe("stripLineNumbers", () => {
	it("should strip line numbers from content", () => {
		const input = "1 | line one\n2 | line two\n3 | line three"
		const expected = "line one\nline two\nline three"
		expect(stripLineNumbers(input)).toBe(expected)
	})

	it("should strip padded line numbers", () => {
		const input = "  1 | line one\n  2 | line two\n  3 | line three"
		const expected = "line one\nline two\nline three"
		expect(stripLineNumbers(input)).toBe(expected)
	})

	it("should handle content without line numbers", () => {
		const input = "line one\nline two\nline three"
		expect(stripLineNumbers(input)).toBe(input)
	})

	it("should handle empty content", () => {
		expect(stripLineNumbers("")).toBe("")
	})

	it("should preserve content with pipe but no line numbers", () => {
		const input = "a | b\nc | d"
		expect(stripLineNumbers(input)).toBe(input)
	})

	it("should handle windows-style line endings", () => {
		const input = "1 | line one\r\n2 | line two\r\n3 | line three"
		const expected = "line one\r\nline two\r\nline three"
		expect(stripLineNumbers(input)).toBe(expected)
	})

	it("should handle content with varying line number widths", () => {
		const input = "  1 | line one\n 10 | line two\n100 | line three"
		const expected = "line one\nline two\nline three"
		expect(stripLineNumbers(input)).toBe(expected)
	})

	describe("aggressive mode", () => {
		it("should strip content with just a pipe character", () => {
			const input = "| line one\n| line two\n| line three"
			const expected = "line one\nline two\nline three"
			expect(stripLineNumbers(input, true)).toBe(expected)
		})

		it("should strip content with mixed formats in aggressive mode", () => {
			const input = "1 | line one\n| line two\n123 | line three"
			const expected = "line one\nline two\nline three"
			expect(stripLineNumbers(input, true)).toBe(expected)
		})

		it("should not strip content with pipe characters not at start in aggressive mode", () => {
			const input = "text | more text\nx | y"
			expect(stripLineNumbers(input, true)).toBe(input)
		})

		it("should handle empty content in aggressive mode", () => {
			expect(stripLineNumbers("", true)).toBe("")
		})

		it("should preserve padding after pipe in aggressive mode", () => {
			const input = "|  line with extra spaces\n1 |  indented content"
			const expected = " line with extra spaces\n indented content"
			expect(stripLineNumbers(input, true)).toBe(expected)
		})

		it("should preserve windows-style line endings in aggressive mode", () => {
			const input = "| line one\r\n| line two\r\n| line three"
			const expected = "line one\r\nline two\r\nline three"
			expect(stripLineNumbers(input, true)).toBe(expected)
		})

		it("should not affect regular content when using aggressive mode", () => {
			const input = "regular line\nanother line\nno pipes here"
			expect(stripLineNumbers(input, true)).toBe(input)
		})
	})
})

describe("truncateOutput", () => {
	it("returns original content when no line limit provided", () => {
		const content = "line1\nline2\nline3"
		expect(truncateOutput(content)).toBe(content)
	})

	it("returns original content when lines are under limit", () => {
		const content = "line1\nline2\nline3"
		expect(truncateOutput(content, 5)).toBe(content)
	})

	it("truncates content with 20/80 split when over limit", () => {
		// Create 25 lines of content
		const lines = Array.from({ length: 25 }, (_, i) => `line${i + 1}`)
		const content = lines.join("\n")

		// Set limit to 10 lines
		const result = truncateOutput(content, 10)

		// Should keep:
		// - First 2 lines (20% of 10)
		// - Last 8 lines (80% of 10)
		// - Omission indicator in between
		const expectedLines = [
			"line1",
			"line2",
			"",
			"[...15 lines omitted...]",
			"",
			"line18",
			"line19",
			"line20",
			"line21",
			"line22",
			"line23",
			"line24",
			"line25",
		]
		expect(result).toBe(expectedLines.join("\n"))
	})

	it("handles empty content", () => {
		expect(truncateOutput("", 10)).toBe("")
	})

	it("handles single line content", () => {
		expect(truncateOutput("single line", 10)).toBe("single line")
	})

	describe("processBackspaces", () => {
		it("should handle basic backspace deletion", () => {
			const input = "abc\b\bxy"
			const expected = "axy"
			expect(processBackspaces(input)).toBe(expected)
		})

		it("should handle backspaces at start of input", () => {
			const input = "\b\babc"
			const expected = "abc"
			expect(processBackspaces(input)).toBe(expected)
		})

		it("should handle backspaces with newlines", () => {
			const input = "abc\b\n123\b\b"
			const expected = "ab\n1"
			expect(processBackspaces(input)).toBe(expected)
		})

		it("should handle consecutive backspaces", () => {
			const input = "abcdef\b\b\b\bxy"
			const expected = "abxy"
			expect(processBackspaces(input)).toBe(expected)
		})

		it("should handle backspaces at end of input", () => {
			const input = "abc\b\b"
			const expected = "a"
			expect(processBackspaces(input)).toBe(expected)
		})

		it("should handle mixed backspaces and content", () => {
			const input = "abc\bx\byz\b\b123"
			const expected = "ab123"
			expect(processBackspaces(input)).toBe(expected)
		})

		it("should handle multiple groups of consecutive backspaces", () => {
			const input = "abc\b\bdef\b\b\bghi\b\b\b\bjkl"
			const expected = "jkl"
			expect(processBackspaces(input)).toBe(expected)
		})

		it("should handle backspaces with empty content between them", () => {
			const input = "abc\b\b\b\b\b\bdef"
			const expected = "def"
			expect(processBackspaces(input)).toBe(expected)
		})

		it("should handle complex mixed content with backspaces", () => {
			const input = "Loading[\b\b\b\b\b\b\b\bProgress[\b\b\b\b\b\b\b\b\bStatus: \b\b\b\b\b\b\b\bDone!"
			// Technically terminal displays "Done!s: [" but we assume \b is destructive as an optimization
			const expected = "Done!"
			expect(processBackspaces(input)).toBe(expected)
		})

		it("should handle backspaces with special characters", () => {
			const input = "abc😀\b\bdef🎉\b\b\bghi"
			const expected = "abcdeghi"
			expect(processBackspaces(input)).toBe(expected)
		})
	})

	it("handles windows-style line endings", () => {
		// Create content with windows line endings
		const lines = Array.from({ length: 15 }, (_, i) => `line${i + 1}`)
		const content = lines.join("\r\n")

		const result = truncateOutput(content, 5)

		// Should keep first line (20% of 5 = 1) and last 4 lines (80% of 5 = 4)
		// Split result by either \r\n or \n to normalize line endings
		const resultLines = result.split(/\r?\n/)
		const expectedLines = ["line1", "", "[...10 lines omitted...]", "", "line12", "line13", "line14", "line15"]
		expect(resultLines).toEqual(expectedLines)
	})
})

describe("applyRunLengthEncoding", () => {
	it("should handle empty input", () => {
		expect(applyRunLengthEncoding("")).toBe("")
		expect(applyRunLengthEncoding(null as any)).toBe(null as any)
		expect(applyRunLengthEncoding(undefined as any)).toBe(undefined as any)
	})

	it("should compress repeated single lines when beneficial", () => {
		const input = "longerline\nlongerline\nlongerline\nlongerline\nlongerline\nlongerline\n"
		const expected = "longerline\n<previous line repeated 5 additional times>\n"
		expect(applyRunLengthEncoding(input)).toBe(expected)
	})

	it("should not compress when not beneficial", () => {
		const input = "y\ny\ny\ny\ny\n"
		expect(applyRunLengthEncoding(input)).toBe(input)
	})
})

describe("processCarriageReturns", () => {
	it("should return original input if no carriage returns (\r) present", () => {
		const input = "Line 1\nLine 2\nLine 3"
		expect(processCarriageReturns(input)).toBe(input)
	})

	it("should process basic progress bar with carriage returns (\r)", () => {
		const input = "Progress: [===>---------] 30%\rProgress: [======>------] 60%\rProgress: [==========>] 100%"
		const expected = "Progress: [==========>] 100%%"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should handle multi-line outputs with carriage returns (\r)", () => {
		const input = "Line 1\rUpdated Line 1\nLine 2\rUpdated Line 2\rFinal Line 2"
		const expected = "Updated Line 1\nFinal Line 2 2"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should handle carriage returns (\r) at end of line", () => {
		// A carriage return (\r) at the end of a line should be treated as if the cursor is at the start
		// with no content following it, so we keep the existing content
		const input = "Initial text\rReplacement text\r"
		// Depending on terminal behavior:
		// Option 1: If last carriage return (\r) is ignored because nothing follows it to replace text
		const expected = "Replacement text"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	// Additional test to clarify behavior with a terminal-like example
	it("should handle carriage returns (\r) in a way that matches terminal behavior", () => {
		// In a real terminal:
		// 1. "Hello" is printed
		// 2. Carriage return (\r) moves cursor to start of line
		// 3. "World" overwrites, becoming "World"
		// 4. Carriage return (\r) moves cursor to start again
		// 5. Nothing follows, so the line remains "World" (cursor just sitting at start)
		const input = "Hello\rWorld\r"
		const expected = "World"
		expect(processCarriageReturns(input)).toBe(expected)

		// Same principle applies to carriage return (\r) + line feed (\n)
		// 1. "Line1" is printed
		// 2. Carriage return (\r) moves cursor to start
		// 3. Line feed (\n) moves to next line, so the line remains "Line1"
		expect(processCarriageReturns("Line1\r\n")).toBe("Line1\n")
	})

	it("should preserve lines without carriage returns (\r)", () => {
		const input = "Line 1\nLine 2\rUpdated Line 2\nLine 3"
		const expected = "Line 1\nUpdated Line 2\nLine 3"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should handle complex tqdm-like progress bars", () => {
		const input =
			"10%|██        | 10/100 [00:01<00:09, 10.00it/s]\r20%|████      | 20/100 [00:02<00:08, 10.00it/s]\r100%|██████████| 100/100 [00:10<00:00, 10.00it/s]"
		const expected = "100%|██████████| 100/100 [00:10<00:00, 10.00it/s]"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should handle ANSI escape sequences", () => {
		const input = "\x1b]633;C\x07Loading\rLoading.\rLoading..\rLoading...\x1b]633;D\x07"
		const expected = "Loading...\x1b]633;D\x07"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should handle mixed content with carriage returns (\r) and line feeds (\n)", () => {
		const input =
			"Step 1: Starting\rStep 1: In progress\rStep 1: Done\nStep 2: Starting\rStep 2: In progress\rStep 2: Done"
		const expected = "Step 1: Donerogress\nStep 2: Donerogress"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should handle empty input", () => {
		expect(processCarriageReturns("")).toBe("")
	})

	it("should handle large number of carriage returns (\r) efficiently", () => {
		// Create a string with many carriage returns (\r)
		let input = ""
		for (let i = 0; i < 10000; i++) {
			input += `Progress: ${i / 100}%\r`
		}
		input += "Progress: 100%"

		const expected = "Progress: 100%9%"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	// Additional edge cases to stress test processCarriageReturns
	it("should handle consecutive carriage returns (\r)", () => {
		const input = "Initial\r\r\r\rFinal"
		const expected = "Finalal"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should handle carriage returns (\r) at the start of a line", () => {
		const input = "\rText after carriage return"
		const expected = "Text after carriage return"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should handle only carriage returns (\r)", () => {
		const input = "\r\r\r\r"
		const expected = ""
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should handle carriage returns (\r) with empty strings between them", () => {
		const input = "Start\r\r\r\r\rEnd"
		const expected = "Endrt"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should handle multiline with carriage returns (\r) at different positions", () => {
		const input = "Line1\rLine1Updated\nLine2\nLine3\rLine3Updated\rLine3Final\nLine4"
		const expected = "Line1Updated\nLine2\nLine3Finaled\nLine4"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should handle carriage returns (\r) with special characters", () => {
		// This test demonstrates our handling of multi-byte characters (like emoji) when they get partially overwritten.
		// When a carriage return (\r) causes partial overwrite of a multi-byte character (like an emoji),
		// we need to handle this special case to prevent display issues or corruption.
		//
		// In this example:
		// 1. "Line with 🚀 emoji" is printed (note that the emoji is a multi-byte character)
		// 2. Carriage return (\r) moves cursor to start of line
		// 3. "Line with a" is printed, which partially overwrites the line
		// 4. The 'a' character ends at a position that would split the 🚀 emoji
		// 5. Instead of creating corrupted output, we insert a space to replace the partial emoji
		//
		// This behavior mimics terminals that can detect and properly handle these situations
		// by replacing partial characters with spaces to maintain text integrity.
		const input = "Line with 🚀 emoji\rLine with a"
		const expected = "Line with a  emoji"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should correctly handle multiple consecutive line feeds (\n) with carriage returns (\r)", () => {
		// Another test case for multi-byte character handling during carriage return (\r) overwrites.
		// In this case, we're testing with a different emoji and pattern to ensure robustness.
		//
		// When a new line with an emoji partially overlaps with text from the previous line,
		// we need to properly detect surrogate pairs and other multi-byte sequences to avoid
		// creating invalid Unicode output.
		//
		// Note: The expected result might look strange but it's consistent with how real
		// terminals process such content - they only overwrite at character boundaries
		// and don't attempt to interpret or normalize the resulting text.
		const input = "Line with not a emoji\rLine with 🔥 emoji"
		const expected = "Line with 🔥 emojioji"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should handle carriage returns (\r) in the middle of non-ASCII text", () => {
		// Tests handling of non-Latin text (like Chinese characters)
		// Non-ASCII text uses multi-byte encodings, so this test verifies our handling works
		// properly with such character sets.
		//
		// Our implementation ensures we preserve character boundaries and don't create
		// invalid sequences when carriage returns (\r) cause partial overwrites.
		const input = "你好世界啊\r你好地球"
		const expected = "你好地球啊"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should correctly handle complex patterns of alternating carriage returns (\r) and line feeds (\n)", () => {
		// Break down the example:
		// 1. "Line1" + carriage return (\r) + line feed (\n): carriage return (\r) moves cursor to start of line, line feed (\n) moves to next line, preserving "Line1"
		// 2. "Line2" + carriage return (\r): carriage return (\r) moves cursor to start of line
		// 3. "Line2Updated" overwrites "Line2"
		// 4. Line feed (\n): moves to next line
		// 5. "Line3" + carriage return (\r) + line feed (\n): carriage return (\r) moves cursor to start, line feed (\n) moves to next line, preserving "Line3"
		const input = "Line1\r\nLine2\rLine2Updated\nLine3\r\n"
		const expected = "Line1\nLine2Updated\nLine3\n"
		expect(processCarriageReturns(input)).toBe(expected)
	})

	it("should handle partial overwrites with carriage returns (\r)", () => {
		// In this case:
		// 1. "Initial text" is printed
		// 2. Carriage return (\r) moves cursor to start of line
		// 3. "next" is printed, overwriting only the first 4 chars
		// 4. Carriage return (\r) moves cursor to start, but nothing follows
		// Final result should be "nextial text" (first 4 chars overwritten)
		const input = "Initial text\rnext\r"
		const expected = "nextial text"
		expect(processCarriageReturns(input)).toBe(expected)
	})
})
