import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { Logger } from "./Logger"

// Production bundles replace `process.env.IS_DEV` with "false" at build time, so
// the default (non-verbose) mode below is what every Marketplace user runs.
describe("Logger", () => {
	const originalIsDev = process.env.IS_DEV
	let lines: string[]

	beforeEach(() => {
		lines = []
		Logger.subscribe(collect)
		delete process.env.IS_DEV
	})

	afterEach(() => {
		Logger.unsubscribe(collect)
		if (originalIsDev === undefined) {
			delete process.env.IS_DEV
		} else {
			process.env.IS_DEV = originalIsDev
		}
	})

	function collect(msg: string) {
		lines.push(msg)
	}

	// Strip the leading ISO timestamp so assertions stay stable.
	function last(): string {
		return lines[lines.length - 1].replace(/^\S+ /, "")
	}

	describe("without IS_DEV (production)", () => {
		it("appends the message of an Error argument", () => {
			Logger.error("[SdkAuthService] Cline OAuth login failed:", new Error("access_denied"))
			expect(last()).toBe("ERROR [SdkAuthService] Cline OAuth login failed: Error: access_denied")
		})

		it("keeps the error type so non-Error subclasses stay distinguishable", () => {
			Logger.warn("failed", new TypeError("bad input"))
			expect(last()).toBe("WARN failed TypeError: bad input")
		})

		it("appends the cause chain of an Error", () => {
			const cause = new Error("connect ECONNREFUSED 127.0.0.1:1")
			Logger.error("request failed:", new Error("fetch failed", { cause }))
			expect(last()).toBe("ERROR request failed: Error: fetch failed (cause: Error: connect ECONNREFUSED 127.0.0.1:1)")
		})

		it("terminates on a cyclic cause chain", () => {
			const a = new Error("a")
			const b = new Error("b", { cause: a })
			;(a as { cause?: unknown }).cause = b
			Logger.error("loop", a)
			expect(last().startsWith("ERROR loop Error: a (cause: Error: b")).toBe(true)
		})

		it("never includes the stack trace", () => {
			const error = new Error("boom")
			error.stack = "Error: boom\n    at secretFunction (/Users/someone/project/file.ts:1:1)"
			Logger.error("failed:", error)
			expect(last()).not.toContain("secretFunction")
		})

		it("appends the message of an error-like object", () => {
			Logger.error("rpc failed:", {
				code: 14,
				message: "14 UNAVAILABLE: No connection established",
				metadata: { token: "x" },
			})
			expect(last()).toBe("ERROR rpc failed: 14 UNAVAILABLE: No connection established")
		})

		it("extracts an Error nested under an `error` key of a metadata object", () => {
			Logger.error("Session cleanup threw", { sessionId: "s1", error: new Error("EPIPE") })
			expect(last()).toBe("ERROR Session cleanup threw Error: EPIPE")
		})

		it("appends every Error among several arguments", () => {
			Logger.error("multi:", new Error("one"), new Error("two"))
			expect(last()).toBe("ERROR multi: Error: one Error: two")
		})

		it("appends numbers and booleans", () => {
			Logger.log("AuthHandler: Server started on port", 4242, true)
			expect(last()).toBe("LOG AuthHandler: Server started on port 4242 true")
		})

		it("still drops strings, so URLs and file contents cannot reach logs", () => {
			Logger.log("Opening browser:", "https://example.com/callback?code=SECRET")
			Logger.log("addSelectedTerminalOutputToChat", "private terminal contents")
			expect(lines.join("\n")).not.toContain("SECRET")
			expect(lines.join("\n")).not.toContain("private terminal contents")
			expect(last()).toBe("LOG addSelectedTerminalOutputToChat")
		})

		it("still drops arbitrary objects, arrays and null", () => {
			Logger.log("settings", { apiKey: "sk-secret" }, ["sk-secret"], null, undefined)
			expect(last()).toBe("LOG settings")
		})

		it("does not read a secret out of an Error that carries extra properties", () => {
			const error = Object.assign(new Error("Request failed with status code 401"), {
				config: { headers: { Authorization: "Bearer sk-secret" } },
			})
			Logger.error("api call failed:", error)
			expect(last()).toBe("ERROR api call failed: Error: Request failed with status code 401")
		})

		it("reduces URLs inside an error message to their origin", () => {
			Logger.error(
				"Failed to add remote MCP server:",
				new Error("Invalid server URL: https://mcp.example.com/sse?api_key=sk-SECRET. Please provide a valid URL."),
			)
			expect(last()).toBe(
				"ERROR Failed to add remote MCP server: Error: Invalid server URL: https://mcp.example.com. Please provide a valid URL.",
			)
		})

		it("drops credentials embedded in the path or userinfo of a URL in an error message", () => {
			Logger.error("connect failed:", new Error('"https://user:pw@actions.example.com/mcp/sk-SECRET/sse" cannot be parsed'))
			expect(last()).not.toContain("SECRET")
			expect(last()).not.toContain("pw")
			expect(last()).toContain("https://actions.example.com")
		})

		it("reduces URLs in cause messages and error-like objects", () => {
			const cause = new Error("GET https://api.example.com/v1/x?token=SECRET_A failed")
			Logger.error("outer:", new Error("wrapped", { cause }))
			Logger.error("rpc:", { message: "redirect to https://example.com/cb?code=SECRET_B" })
			expect(lines.join("\n")).not.toContain("SECRET")
		})
	})

	describe("with IS_DEV=true (verbose)", () => {
		beforeEach(() => {
			process.env.IS_DEV = "true"
		})

		it("appends the stack of an Error instead of serializing it to {}", () => {
			const error = new Error("boom")
			error.stack = "Error: boom\n    at f (file.ts:1:1)"
			Logger.error("failed:", error)
			expect(last()).toBe("ERROR failed: Error: boom\n    at f (file.ts:1:1)")
		})

		it("serializes strings and objects", () => {
			Logger.log("data", "https://example.com/?a=1", { a: 1 })
			expect(last()).toBe('LOG data "https://example.com/?a=1" {"a":1}')
		})

		it("survives a circular argument without dropping the whole line", () => {
			const circular: Record<string, unknown> = {}
			circular.self = circular
			Logger.log("circular", circular)
			expect(last().startsWith("LOG circular")).toBe(true)
		})
	})
})
