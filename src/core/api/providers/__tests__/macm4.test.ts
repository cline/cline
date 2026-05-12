import { beforeEach, describe, it } from "mocha"
import "should"
import { listMacM4Tiers, MACM4_TIERS, MacM4Handler, macm4DefaultModelId } from "../macm4"

describe("MacM4 tier catalogue", () => {
	it("exposes the canonical tier ids that match config/litellm-config.yaml", () => {
		const ids = Object.keys(MACM4_TIERS)
		ids.should.containEql("local-fast")
		ids.should.containEql("local-long")
		ids.should.containEql("claude-haiku-4-5")
		ids.should.containEql("claude-sonnet-4-6")
		ids.should.containEql("claude-opus-4-7")
		ids.should.containEql("claude-code")
		ids.should.containEql("hybrid-auto")
	})

	it("pins context windows to the values served by the MacM4 stack", () => {
		MACM4_TIERS["local-fast"].contextWindow.should.equal(16_384)
		MACM4_TIERS["local-long"].contextWindow.should.equal(131_072)
		MACM4_TIERS["claude-opus-4-7"].contextWindow.should.equal(1_000_000)
	})

	it("flags local tiers as isLocal=true and cloud as false", () => {
		MACM4_TIERS["local-fast"].isLocal.should.equal(true)
		MACM4_TIERS["local-long"].isLocal.should.equal(true)
		MACM4_TIERS["claude-sonnet-4-6"].isLocal.should.equal(false)
		MACM4_TIERS["hybrid-auto"].isLocal.should.equal(false)
	})

	it("listMacM4Tiers returns a UI-friendly shape covering every tier", () => {
		const tiers = listMacM4Tiers()
		tiers.length.should.equal(Object.keys(MACM4_TIERS).length)
		tiers.forEach((t) => {
			t.should.have.property("id")
			t.should.have.property("description")
			t.should.have.property("contextWindow")
			t.should.have.property("isLocal")
		})
	})

	it("defaults to hybrid-auto", () => {
		macm4DefaultModelId.should.equal("hybrid-auto")
	})
})

describe("MacM4Handler.getModel", () => {
	it("returns the requested tier id and pre-baked ModelInfo", () => {
		const h = new MacM4Handler({ macm4ModelId: "local-long" })
		const { id, info } = h.getModel()
		id.should.equal("local-long")
		;(info.contextWindow ?? 0).should.equal(131_072)
		;(info.maxTokens ?? 0).should.equal(6144)
		;(info.supportsImages ?? false).should.equal(false)
		;(info.supportsPromptCache ?? false).should.equal(false)
	})

	it("returns the default tier when none is configured", () => {
		const h = new MacM4Handler({})
		h.getModel().id.should.equal("hybrid-auto")
	})

	it("returns sane defaults for an unknown tier id (no crash)", () => {
		const h = new MacM4Handler({ macm4ModelId: "this-tier-does-not-exist" })
		const { id, info } = h.getModel()
		id.should.equal("this-tier-does-not-exist")
		;(info.contextWindow ?? 0).should.be.greaterThan(0)
	})

	it("sets non-zero prices for cloud Claude tiers, zero for local", () => {
		const local = new MacM4Handler({ macm4ModelId: "local-fast" }).getModel().info
		;(local.inputPrice ?? 0).should.equal(0)
		;(local.outputPrice ?? 0).should.equal(0)

		const cloud = new MacM4Handler({ macm4ModelId: "claude-opus-4-7" }).getModel().info
		;(cloud.inputPrice ?? 0).should.equal(5.0)
		;(cloud.outputPrice ?? 0).should.equal(25.0)
	})
})

describe("MacM4Handler client routing", () => {
	let handler: MacM4Handler

	beforeEach(() => {
		handler = new MacM4Handler({
			macm4ModelId: "local-long",
			macm4BaseUrl: "http://127.0.0.1:4000",
			macm4OllamaBaseUrl: "http://127.0.0.1:11434",
		})
	})

	it("uses the direct Ollama client for local-long by default", () => {
		const route = (handler as any).clientFor("local-long")
		route.client.should.have.property("baseURL")
		// Ollama OpenAI-compat endpoint lives under /v1
		route.client.baseURL.should.containEql("11434")
		route.client.baseURL.should.endWith("/v1")
	})

	it("uses the LiteLLM proxy client for hybrid-auto", () => {
		const route = (handler as any).clientFor("hybrid-auto")
		route.client.baseURL.should.containEql("4000")
		route.model.should.equal("hybrid-auto")
	})

	it("uses the LiteLLM proxy client for cloud Claude tiers", () => {
		const route = (handler as any).clientFor("claude-sonnet-4-6")
		route.client.baseURL.should.containEql("4000")
		route.model.should.equal("claude-sonnet-4-6")
	})

	it("uses the LiteLLM proxy client for local-fast (MLX)", () => {
		// local-fast is served by MLX, not Ollama, so the direct-Ollama
		// bypass shouldn't engage. Goes through the proxy.
		const route = (handler as any).clientFor("local-fast")
		route.client.baseURL.should.containEql("4000")
	})

	it("falls back to proxy for local-long when macm4UseDirectOllama=false", () => {
		const optedOut = new MacM4Handler({
			macm4ModelId: "local-long",
			macm4UseDirectOllama: false,
		})
		const route = (optedOut as any).clientFor("local-long")
		route.client.baseURL.should.containEql("4000")
		route.model.should.equal("local-long")
	})
})
