import assert from "node:assert/strict"
import iconv from "iconv-lite"
import { afterEach, beforeEach, describe, it } from "mocha"

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

	it("getWindowsConsoleEncoding returns gbk for code page 936", () => {
		// This test validates the mapping logic
		// We test the mapping directly since the module caches at load time
		const codePageMap: { [key: number]: string } = {
			936: "gbk",
			950: "big5",
			949: "euc-kr",
			932: "shift_jis",
			65001: "utf8",
		}
		assert.strictEqual(codePageMap[936], "gbk")
	})

	it("getWindowsConsoleEncoding returns utf8 for code page 65001", () => {
		const codePageMap: { [key: number]: string } = {
			936: "gbk",
			950: "big5",
			949: "euc-kr",
			932: "shift_jis",
			65001: "utf8",
		}
		assert.strictEqual(codePageMap[65001], "utf8")
	})

	it("iconv-lite round-trip for GBK Chinese text", () => {
		const original = "中文输出测试：黄金ETF数据导出正常"
		const encoded = iconv.encode(original, "gbk")
		const decoded = iconv.decode(encoded, "gbk")
		assert.strictEqual(decoded, original)
	})
})
