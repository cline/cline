import { describe, it, beforeEach, afterEach } from "mocha"
import "should"
import sinon from "sinon"

// We stub the proxy-aware fetch wrapper that macm4-warmup.ts imports.
// All HTTP-shaped behavior is driven through this stub so the tests
// run completely offline.
import * as net from "@/shared/net"
import { warmupMacM4Tier } from "../macm4-warmup"

function jsonResponse(body: unknown, ok: boolean = true): Response {
	return {
		ok,
		status: ok ? 200 : 500,
		json: async () => body,
	} as unknown as Response
}

describe("warmupMacM4Tier", () => {
	let fetchStub: sinon.SinonStub

	beforeEach(() => {
		fetchStub = sinon.stub(net, "fetch")
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("cloud tiers", () => {
		it("skips warm-up for claude-* tiers", async () => {
			const r = await warmupMacM4Tier({ tierId: "claude-opus-4-7" })
			r.status.should.equal("skipped")
			fetchStub.called.should.equal(false)
		})

		it("skips warm-up for hybrid-auto (router pseudo-tier)", async () => {
			const r = await warmupMacM4Tier({ tierId: "hybrid-auto" })
			r.status.should.equal("skipped")
		})

		it("strips gpt- prefix before classifying cloud tiers", async () => {
			const r = await warmupMacM4Tier({ tierId: "gpt-claude-haiku-4-5" })
			r.status.should.equal("skipped")
		})
	})

	describe("local-fast (MLX)", () => {
		it("returns warm when MLX /health responds OK", async () => {
			fetchStub.resolves(jsonResponse({ ok: true }))
			const r = await warmupMacM4Tier({ tierId: "local-fast" })
			r.status.should.equal("warm")
			if (r.status === "warm") {
				r.source.should.equal("mlx-health")
			}
		})

		it("falls back to /v1/models when /health is unavailable", async () => {
			fetchStub.onFirstCall().rejects(new Error("connection refused"))
			fetchStub.onSecondCall().resolves(jsonResponse({ data: [] }))
			const r = await warmupMacM4Tier({ tierId: "local-fast" })
			r.status.should.equal("warm")
		})

		it("returns failed when MLX is fully unreachable", async () => {
			fetchStub.rejects(new Error("connection refused"))
			const r = await warmupMacM4Tier({ tierId: "local-fast" })
			r.status.should.equal("failed")
			if (r.status === "failed") {
				r.reason.should.containEql("MLX server")
			}
		})
	})

	describe("local-long (Ollama)", () => {
		it("returns warm via dashboard when /api/macm4-models reports warm=true", async () => {
			fetchStub.resolves(
				jsonResponse({
					data: [
						{ id: "local-long", warm: true },
						{ id: "local-fast", warm: true },
					],
				}),
			)
			const r = await warmupMacM4Tier({ tierId: "local-long" })
			r.status.should.equal("warm")
			if (r.status === "warm") {
				r.source.should.equal("dashboard")
			}
		})

		it("falls back to Ollama /api/ps when dashboard is unreachable", async () => {
			fetchStub.onFirstCall().rejects(new Error("dashboard down"))
			fetchStub.onSecondCall().resolves(
				jsonResponse({
					models: [{ name: "qwen3-coder-next:q4_K_M" }],
				}),
			)
			const r = await warmupMacM4Tier({
				tierId: "local-long",
				ollamaModelTag: "qwen3-coder-next:q4_K_M",
			})
			r.status.should.equal("warm")
			if (r.status === "warm") {
				r.source.should.equal("ollama-ps")
			}
		})

		it("triggers an explicit Ollama load when nothing reports warm", async () => {
			// dashboard: warm=false
			fetchStub.onFirstCall().resolves(
				jsonResponse({ data: [{ id: "local-long", warm: false }] }),
			)
			// /api/ps: model not in loaded set
			fetchStub.onSecondCall().resolves(jsonResponse({ models: [] }))
			// /api/generate: loads OK (any 2xx)
			fetchStub.onThirdCall().resolves(jsonResponse({}))

			const r = await warmupMacM4Tier({ tierId: "local-long" })
			r.status.should.equal("loaded")
			if (r.status === "loaded") {
				r.durationMs.should.be.greaterThanOrEqual(0)
			}
			// Verify the third call was the load trigger.
			const loadCall = fetchStub.getCall(2)
			loadCall.args[0].should.containEql("/api/generate")
			JSON.parse(loadCall.args[1].body).should.have.property("keep_alive", -1)
		})

		it("returns failed if the load trigger HTTP call fails", async () => {
			fetchStub.onFirstCall().resolves(
				jsonResponse({ data: [{ id: "local-long", warm: false }] }),
			)
			fetchStub.onSecondCall().resolves(jsonResponse({ models: [] }))
			fetchStub.onThirdCall().rejects(new Error("simulated outage"))

			const r = await warmupMacM4Tier({ tierId: "local-long" })
			r.status.should.equal("failed")
		})
	})

	describe("unknown tier", () => {
		it("returns skipped for an unrecognised local tier id", async () => {
			const r = await warmupMacM4Tier({ tierId: "fancy-new-tier" })
			r.status.should.equal("skipped")
		})
	})
})
