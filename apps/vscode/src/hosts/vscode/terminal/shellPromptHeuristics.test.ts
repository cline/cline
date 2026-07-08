import { describe, expect, it } from "bun:test"
import { getLastLine, looksLikeShellPrompt } from "./shellPromptHeuristics"

describe("getLastLine", () => {
	it("returns the whole string when there are no newlines", () => {
		expect(getLastLine("user@host:~$ ")).toBe("user@host:~$ ")
	})

	it("returns the last line, ignoring trailing newlines", () => {
		expect(getLastLine("output\nuser@host:~$ \n")).toBe("user@host:~$ ")
	})

	it("returns content after the last carriage return (line overwrite)", () => {
		expect(getLastLine("progress 10%\rprogress 100%")).toBe("progress 100%")
	})

	it("returns empty string for empty or newline-only input", () => {
		expect(getLastLine("")).toBe("")
		expect(getLastLine("\n\r\n")).toBe("")
	})
})

describe("looksLikeShellPrompt", () => {
	it.each([
		["bash", "user@host:~$ "],
		["bash root", "root@host:/etc# "],
		["zsh", "host% "],
		["fish/generic", "~/project> "],
		["python REPL", ">>> "],
		["starship", "\u276f "],
		["powershell", "PS C:\\Users\\me> "],
		["command prompt", "C:\\Users\\me>"],
	])("detects %s prompt", (_name, line) => {
		expect(looksLikeShellPrompt(line)).toBe(true)
	})

	it.each([
		["empty", ""],
		["whitespace only", "   "],
		["regular output", "Compiling module foo"],
		["sentence", "Done."],
		["progress", "downloading 57%|"],
	])("does not detect %s as a prompt", (_name, line) => {
		expect(looksLikeShellPrompt(line)).toBe(false)
	})
})
