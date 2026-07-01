import { describe, expect, it } from "bun:test"
import { Osc633EventType, Osc633Parser } from "./osc633Parser"

// Helper to build OSC 633 sequences.
function osc633(payload: string, terminator: "bel" | "st" = "bel"): string {
	const term = terminator === "bel" ? "\x07" : "\x1b\\"
	return `\x1b]633;${payload}${term}`
}

describe("Osc633Parser", () => {
	describe("basic sequence extraction", () => {
		it("returns data unchanged with no events when there are no sequences", () => {
			const parser = new Osc633Parser()
			const result = parser.parse("hello world")
			expect(result.cleanedData).toBe("hello world")
			expect(result.events).toEqual([])
		})

		it("extracts PromptStart (A) with BEL terminator and strips it", () => {
			const parser = new Osc633Parser()
			const result = parser.parse(`before${osc633("A")}after`)
			expect(result.cleanedData).toBe("beforeafter")
			expect(result.events).toEqual([{ type: Osc633EventType.PromptStart }])
		})

		it("extracts CommandStart (B)", () => {
			const parser = new Osc633Parser()
			const result = parser.parse(osc633("B"))
			expect(result.cleanedData).toBe("")
			expect(result.events).toEqual([{ type: Osc633EventType.CommandStart }])
		})

		it("extracts CommandExecuted (C)", () => {
			const parser = new Osc633Parser()
			const result = parser.parse(osc633("C"))
			expect(result.cleanedData).toBe("")
			expect(result.events).toEqual([{ type: Osc633EventType.CommandExecuted }])
		})
	})

	describe("CommandFinished (D) exit codes", () => {
		it("parses no exit code", () => {
			const parser = new Osc633Parser()
			const result = parser.parse(osc633("D"))
			expect(result.events).toEqual([{ type: Osc633EventType.CommandFinished, exitCode: undefined }])
		})

		it("parses exit code 0", () => {
			const parser = new Osc633Parser()
			const result = parser.parse(osc633("D;0"))
			expect(result.events).toEqual([{ type: Osc633EventType.CommandFinished, exitCode: 0 }])
		})

		it("parses non-zero exit code", () => {
			const parser = new Osc633Parser()
			const result = parser.parse(osc633("D;127"))
			expect(result.events).toEqual([{ type: Osc633EventType.CommandFinished, exitCode: 127 }])
		})
	})

	describe("CommandLine (E) and Property (P)", () => {
		it("parses command line with nonce and decodes escapes", () => {
			const parser = new Osc633Parser()
			const result = parser.parse(osc633("E;echo\\x20hello;my-nonce"))
			expect(result.events).toEqual([{ type: Osc633EventType.CommandLine, commandLine: "echo hello", nonce: "my-nonce" }])
		})

		it("parses Cwd property", () => {
			const parser = new Osc633Parser()
			const result = parser.parse(osc633("P;Cwd=/Users/test"))
			expect(result.events).toEqual([{ type: Osc633EventType.Property, key: "Cwd", value: "/Users/test" }])
		})
	})

	describe("output between C and D markers", () => {
		it("keeps the command output and strips both markers (single chunk)", () => {
			const parser = new Osc633Parser()
			const result = parser.parse(`${osc633("C")}hi\n${osc633("D;0")}`)
			expect(result.cleanedData).toBe("hi\n")
			expect(result.events.map((e) => e.type)).toEqual([Osc633EventType.CommandExecuted, Osc633EventType.CommandFinished])
		})
	})

	describe("partial sequences across chunks", () => {
		it("handles a sequence split in the payload (the ';C' case)", () => {
			const parser = new Osc633Parser()
			// Chunk ends right after `633;`, next chunk starts with `C`.
			const r1 = parser.parse("before\x1b]633;")
			expect(r1.cleanedData).toBe("before")
			expect(r1.events).toEqual([])

			const r2 = parser.parse("C\x07hi")
			expect(r2.cleanedData).toBe("hi")
			expect(r2.events).toEqual([{ type: Osc633EventType.CommandExecuted }])
		})

		it("handles a sequence split at the ESC of an ST terminator", () => {
			const parser = new Osc633Parser()
			const r1 = parser.parse("data\x1b]633;D;42\x1b")
			expect(r1.cleanedData).toBe("data")
			expect(r1.events).toEqual([])

			const r2 = parser.parse("\\more")
			expect(r2.cleanedData).toBe("more")
			expect(r2.events).toEqual([{ type: Osc633EventType.CommandFinished, exitCode: 42 }])
		})

		it("handles a sequence split across three chunks", () => {
			const parser = new Osc633Parser()
			expect(parser.parse("\x1b]63").cleanedData).toBe("")
			expect(parser.parse("3;C").cleanedData).toBe("")
			const r3 = parser.parse("\x07output")
			expect(r3.cleanedData).toBe("output")
			expect(r3.events).toEqual([{ type: Osc633EventType.CommandExecuted }])
		})

		it("streams output between C and D arriving in separate chunks (slow command)", () => {
			const parser = new Osc633Parser()
			// echo hi; sleep 40; echo there — C and first output arrive early...
			const r1 = parser.parse(`${osc633("C")}hi\n`)
			expect(r1.cleanedData).toBe("hi\n")
			expect(r1.events).toEqual([{ type: Osc633EventType.CommandExecuted }])

			// ...the rest of the output streams in later, before D arrives.
			const r2 = parser.parse("there\n")
			expect(r2.cleanedData).toBe("there\n")
			expect(r2.events).toEqual([])

			// ...and D arrives last.
			const r3 = parser.parse(osc633("D;0"))
			expect(r3.cleanedData).toBe("")
			expect(r3.events).toEqual([{ type: Osc633EventType.CommandFinished, exitCode: 0 }])
		})
	})

	describe("non-633 OSC passthrough", () => {
		it("preserves a window-title OSC 0 sequence", () => {
			const parser = new Osc633Parser()
			const input = "before\x1b]0;window title\x07after"
			const result = parser.parse(input)
			expect(result.cleanedData).toBe(input)
			expect(result.events).toEqual([])
		})

		it("preserves a non-633 OSC sequence split at the ESC of its ST terminator", () => {
			const parser = new Osc633Parser()
			const r1 = parser.parse("before\x1b]0;window title\x1b")
			expect(r1.cleanedData).toBe("before")
			expect(r1.events).toEqual([])

			const r2 = parser.parse("\\after")
			expect(r2.cleanedData).toBe("\x1b]0;window title\x1b\\after")
			expect(r2.events).toEqual([])
		})
	})

	describe("full command lifecycle", () => {
		it("extracts events and clean output across interleaved chunks", () => {
			const parser = new Osc633Parser()
			let cleaned = ""
			const events: number[] = []

			for (const chunk of [
				`${osc633("A")}user@host:~ $ ${osc633("B")}`,
				`${osc633("E;echo\\x20hi;nonce1")}${osc633("C")}`,
				"hi\r\n",
				`${osc633("D;0")}${osc633("A")}`,
			]) {
				const r = parser.parse(chunk)
				cleaned += r.cleanedData
				events.push(...r.events.map((e) => e.type))
			}

			expect(cleaned).toBe("user@host:~ $ hi\r\n")
			expect(events).toEqual([
				Osc633EventType.PromptStart,
				Osc633EventType.CommandStart,
				Osc633EventType.CommandLine,
				Osc633EventType.CommandExecuted,
				Osc633EventType.CommandFinished,
				Osc633EventType.PromptStart,
			])
		})
	})
})
