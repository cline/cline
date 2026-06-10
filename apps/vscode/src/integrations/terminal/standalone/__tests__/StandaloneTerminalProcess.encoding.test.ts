import assert from "node:assert/strict"
import iconv from "iconv-lite"
import { afterEach, beforeEach, describe, it } from "mocha"
import { getWindowsConsoleEncoding } from "../windowsEncoding"

describe("StandaloneTerminalProcess encoding", () => {
	beforeEach(() => {
		// Test setup
	})

	afterEach(() => {
		// Cleanup
	})

	it("decodes GBK-encoded buffer correctly", () => {
		const chineseString = "中文输出测试：黄金ETF数据导出正常"
		const gbkBuffer = iconv.encode(chineseString, "gbk")
		const decoded = iconv.decode(gbkBuffer, "gbk")
		assert.strictEqual(decoded, chineseString)
	})

	it("decodes UTF-8-encoded buffer correctly", () => {
		const utf8String = "hello"
		const utf8Buffer = Buffer.from(utf8String, "utf8")
		const decoded = iconv.decode(utf8Buffer, "utf8")
		assert.strictEqual(decoded, utf8String)
	})

	it("getWindowsConsoleEncoding returns a valid encoding supported by iconv-lite", () => {
		// This test validates that the real getWindowsConsoleEncoding function
		// returns a value that is supported by iconv-lite
		const result = getWindowsConsoleEncoding()
		assert.ok(iconv.encodingExists(result), `Encoding ${result} is not supported by iconv-lite`)
	})

	it("getWindowsConsoleEncoding returns utf8 on non-Windows platforms", () => {
		// On non-Windows systems, should always return utf8
		const result = getWindowsConsoleEncoding()
		if (process.platform !== "win32") {
			assert.strictEqual(result, "utf8")
		}
	})

	it("iconv-lite round-trip for GBK Chinese text", () => {
		const original = "中文输出测试：黄金ETF数据导出正常"
		const encoded = iconv.encode(original, "gbk")
		const decoded = iconv.decode(encoded, "gbk")
		assert.strictEqual(decoded, original)
	})
})
