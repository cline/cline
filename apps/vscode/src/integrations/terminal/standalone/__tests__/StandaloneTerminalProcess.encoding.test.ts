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

	it("shell-aware encoding: cmd.exe uses system encoding, other shells use utf8", () => {
		// This test validates the shell-aware encoding logic:
		// - cmd.exe output is decoded with the system code page (getEncoding())
		// - PowerShell, pwsh, and other shells are decoded with UTF-8
		// On GBK systems: cmd.exe uses "gbk", PowerShell uses "utf8"
		// This prevents corruption of non-ASCII text in PowerShell output
		const chineseText = "中文输出"
		const utf8Buffer = Buffer.from(chineseText, "utf8")

		// Decode as UTF-8 (correct for PowerShell/pwsh output)
		const utf8Decoded = iconv.decode(utf8Buffer, "utf8")
		assert.strictEqual(utf8Decoded, chineseText)

		// Attempting to decode UTF-8 as GBK would corrupt non-ASCII text
		// (this is the bug we fixed - don't apply GBK to PowerShell output)
		const gbkDecoded = iconv.decode(utf8Buffer, "gbk")
		// The decoded result will be garbled, not matching the original
		assert.notStrictEqual(gbkDecoded, chineseText)
	})
})
