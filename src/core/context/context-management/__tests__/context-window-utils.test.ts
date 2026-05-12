import { describe, it } from "mocha"
import "should"
import type { ApiHandler } from "@core/api"
import { getContextWindowInfo } from "../context-window-utils"

// Minimal ApiHandler stub — getContextWindowInfo only reads getModel().
const handler = (id: string, contextWindow?: number): ApiHandler =>
	({
		getModel: () => ({
			id,
			info: {
				contextWindow,
			},
		}),
	}) as unknown as ApiHandler

describe("getContextWindowInfo (MacM4 local tiers)", () => {
	describe("local-fast tier (16K)", () => {
		it("coerces 'local-fast' regardless of reported window", () => {
			const r = getContextWindowInfo(handler("local-fast", 128_000))
			r.contextWindow.should.equal(16_384)
			r.maxAllowedSize.should.equal(16_384 - 3_000)
		})

		it("matches the Cursor-shaped gpt-local-fast mirror", () => {
			const r = getContextWindowInfo(handler("gpt-local-fast"))
			r.contextWindow.should.equal(16_384)
		})

		it("matches macm4-local-fast", () => {
			const r = getContextWindowInfo(handler("macm4-local-fast"))
			r.contextWindow.should.equal(16_384)
		})

		it("matches case-insensitively", () => {
			const r = getContextWindowInfo(handler("Local-Fast"))
			r.contextWindow.should.equal(16_384)
		})
	})

	describe("local-long tier (131K)", () => {
		it("coerces 'local-long' to the Ollama num_ctx value", () => {
			const r = getContextWindowInfo(handler("local-long", 128_000))
			r.contextWindow.should.equal(131_072)
			// 70% saturation threshold
			r.maxAllowedSize.should.equal(Math.floor(131_072 * 0.7))
		})

		it("matches the agent / coder aliases that resolve to local-long", () => {
			getContextWindowInfo(handler("local-agent")).contextWindow.should.equal(131_072)
			getContextWindowInfo(handler("local-coder-14b")).contextWindow.should.equal(131_072)
			getContextWindowInfo(handler("local-coder-32b")).contextWindow.should.equal(131_072)
		})

		it("matches gpt-local-long mirror", () => {
			getContextWindowInfo(handler("gpt-local-long")).contextWindow.should.equal(131_072)
		})

		it("worst-cases hybrid-auto to local-long bounds (router may land there)", () => {
			getContextWindowInfo(handler("hybrid-auto")).contextWindow.should.equal(131_072)
		})

		it("truncation kicks in earlier than cloud tiers (70% vs 80%)", () => {
			const r = getContextWindowInfo(handler("local-long"))
			const utilisation = r.maxAllowedSize / r.contextWindow
			utilisation.should.be.lessThan(0.75)
			utilisation.should.be.greaterThan(0.65)
		})
	})

	describe("backwards-compatible behavior", () => {
		it("keeps the 128K cloud default for non-MacM4 ids", () => {
			const r = getContextWindowInfo(handler("claude-3-5-sonnet-20241022", 128_000))
			r.contextWindow.should.equal(128_000)
			r.maxAllowedSize.should.equal(98_000) // 128k - 30k
		})

		it("keeps the 200K Claude default", () => {
			const r = getContextWindowInfo(handler("claude-opus-4-7", 200_000))
			r.contextWindow.should.equal(200_000)
			r.maxAllowedSize.should.equal(160_000) // 200k - 40k
		})

		it("keeps the 64K DeepSeek default", () => {
			const r = getContextWindowInfo(handler("deepseek-chat", 64_000))
			r.contextWindow.should.equal(64_000)
			r.maxAllowedSize.should.equal(37_000) // 64k - 27k
		})
	})
})
