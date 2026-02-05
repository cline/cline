import { describe, expect, it } from "vitest"
import { selectOutputMode } from "./mode-selection"

describe("selectOutputMode", () => {
	describe("interactive mode (Ink)", () => {
		it("should use interactive mode when both stdin and stdout are TTY", () => {
			const result = selectOutputMode({
				stdoutIsTTY: true,
				stdinIsTTY: true,
				stdinWasPiped: false,
			})
			expect(result.usePlainTextMode).toBe(false)
			expect(result.reason).toBe("interactive")
		})
	})

	describe("yolo flag", () => {
		it("should use plain text mode when --yolo flag is set", () => {
			const result = selectOutputMode({
				stdoutIsTTY: true,
				stdinIsTTY: true,
				stdinWasPiped: false,
				yolo: true,
			})
			expect(result.usePlainTextMode).toBe(true)
			expect(result.reason).toBe("yolo_flag")
		})

		it("should prioritize yolo over other flags", () => {
			const result = selectOutputMode({
				stdoutIsTTY: false,
				stdinIsTTY: false,
				stdinWasPiped: true,
				json: true,
				yolo: true,
			})
			expect(result.reason).toBe("yolo_flag")
		})
	})

	describe("json flag", () => {
		it("should use plain text mode when --json flag is set", () => {
			const result = selectOutputMode({
				stdoutIsTTY: true,
				stdinIsTTY: true,
				stdinWasPiped: false,
				json: true,
			})
			expect(result.usePlainTextMode).toBe(true)
			expect(result.reason).toBe("json")
		})
	})

	describe("piped stdin", () => {
		it("should use plain text mode when stdin was piped (echo x | cline)", () => {
			const result = selectOutputMode({
				stdoutIsTTY: true,
				stdinIsTTY: false, // piped stdin is not a TTY
				stdinWasPiped: true,
			})
			expect(result.usePlainTextMode).toBe(true)
			expect(result.reason).toBe("piped_stdin")
		})

		it("should use plain text mode when stdin was piped but empty (echo '' | cline 'prompt')", () => {
			const result = selectOutputMode({
				stdoutIsTTY: true,
				stdinIsTTY: false,
				stdinWasPiped: true, // empty pipe still counts as piped
			})
			expect(result.usePlainTextMode).toBe(true)
			expect(result.reason).toBe("piped_stdin")
		})
	})

	describe("stdin redirected (< /dev/null)", () => {
		it("should use plain text mode when stdin is redirected from /dev/null", () => {
			// cline "prompt" < /dev/null
			// stdin is not a TTY, but also not a FIFO/file, so stdinWasPiped=false
			const result = selectOutputMode({
				stdoutIsTTY: true,
				stdinIsTTY: false, // redirected, not a TTY
				stdinWasPiped: false, // /dev/null is a character device, not FIFO
			})
			expect(result.usePlainTextMode).toBe(true)
			expect(result.reason).toBe("stdin_redirected")
		})
	})

	describe("stdout redirected", () => {
		it("should use plain text mode when stdout is redirected to file", () => {
			// cline "prompt" > output.txt
			const result = selectOutputMode({
				stdoutIsTTY: false,
				stdinIsTTY: true,
				stdinWasPiped: false,
			})
			expect(result.usePlainTextMode).toBe(true)
			expect(result.reason).toBe("stdout_redirected")
		})

		it("should use plain text mode when stdout is piped", () => {
			// cline "prompt" | grep something
			const result = selectOutputMode({
				stdoutIsTTY: false,
				stdinIsTTY: true,
				stdinWasPiped: false,
			})
			expect(result.usePlainTextMode).toBe(true)
			expect(result.reason).toBe("stdout_redirected")
		})
	})

	describe("GitHub Actions scenarios", () => {
		it("should use plain text mode in GitHub Actions (stdin is empty FIFO)", () => {
			// In GitHub Actions: stdin is an empty FIFO pipe
			// stdinIsTTY=false, stdinWasPiped=true (FIFO detected)
			const result = selectOutputMode({
				stdoutIsTTY: true, // GitHub Actions stdout is TTY-like
				stdinIsTTY: false,
				stdinWasPiped: true, // empty FIFO still counts as piped
			})
			expect(result.usePlainTextMode).toBe(true)
		})

		it("should use plain text mode with --yolo in CI", () => {
			const result = selectOutputMode({
				stdoutIsTTY: false,
				stdinIsTTY: false,
				stdinWasPiped: false,
				yolo: true,
			})
			expect(result.usePlainTextMode).toBe(true)
			expect(result.reason).toBe("yolo_flag")
		})
	})

	describe("real-world scenarios", () => {
		it("cline (no args, interactive terminal)", () => {
			const result = selectOutputMode({
				stdoutIsTTY: true,
				stdinIsTTY: true,
				stdinWasPiped: false,
			})
			expect(result.usePlainTextMode).toBe(false)
		})

		it('cline "prompt" (prompt arg, interactive terminal)', () => {
			const result = selectOutputMode({
				stdoutIsTTY: true,
				stdinIsTTY: true,
				stdinWasPiped: false,
			})
			expect(result.usePlainTextMode).toBe(false)
		})

		it('cat file | cline "explain"', () => {
			const result = selectOutputMode({
				stdoutIsTTY: true,
				stdinIsTTY: false,
				stdinWasPiped: true,
			})
			expect(result.usePlainTextMode).toBe(true)
		})

		it('cline --yolo "prompt"', () => {
			const result = selectOutputMode({
				stdoutIsTTY: true,
				stdinIsTTY: true,
				stdinWasPiped: false,
				yolo: true,
			})
			expect(result.usePlainTextMode).toBe(true)
		})

		it('cline "prompt" < /dev/null', () => {
			const result = selectOutputMode({
				stdoutIsTTY: true,
				stdinIsTTY: false,
				stdinWasPiped: false,
			})
			expect(result.usePlainTextMode).toBe(true)
		})

		it('cline "prompt" > output.log', () => {
			const result = selectOutputMode({
				stdoutIsTTY: false,
				stdinIsTTY: true,
				stdinWasPiped: false,
			})
			expect(result.usePlainTextMode).toBe(true)
		})
	})
})
