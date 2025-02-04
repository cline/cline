import { describe, it, expect } from "vitest"
import { detectPlatform, detectMetaKeyChar, unknown } from "../platformDetection"

describe("detectPlatform", () => {
	it("should detect Windows platform and Chrome browser", () => {
		const userAgent =
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3"
		const result = detectPlatform(userAgent)
		expect(result).toEqual({ os: "windows", browser: "chrome", version: "58.0.3029.110" })
	})

	it("should detect macOS platform and Safari browser", () => {
		const userAgent =
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15"
		const result = detectPlatform(userAgent)
		expect(result).toEqual({ os: "mac", browser: "safari", version: "14.0.3" })
	})

	it("should detect Linux platform and Firefox browser", () => {
		const userAgent = "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0"
		const result = detectPlatform(userAgent)
		expect(result).toEqual({ os: "linux", browser: "firefox", version: "89.0" })
	})

	it("should return unknown for unsupported user agent", () => {
		const userAgent = "Unknown User Agent"
		const result = detectPlatform(userAgent)
		expect(result).toEqual({ os: unknown, browser: unknown, version: unknown })
	})
})

describe("detectMetaKeyChar", () => {
	it("should return ⌘ Command for mac platform", () => {
		const result = detectMetaKeyChar("mac")
		expect(result).toBe("⌘ Command")
	})

	it("should return ⊞ Win for windows platform", () => {
		const result = detectMetaKeyChar("windows")
		expect(result).toBe("⊞ Win")
	})

	it("should return Alt for other platforms", () => {
		const result = detectMetaKeyChar("linux")
		expect(result).toBe("Alt")
	})
})
