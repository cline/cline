import { StringArray } from "@shared/proto/cline/common"
import { expect } from "chai"
import { describe, it } from "mocha"
import sinon from "sinon"
import { mockFetchForTesting } from "@/shared/net"
import { getLmStudioModels } from "../getLmStudioModels"

describe("getLmStudioModels", () => {
	it("passes the configured LM Studio API key when fetching models", async () => {
		const fetchStub = sinon.stub().resolves({
			json: async () => ({
				data: [{ id: "qwen/qwen3", max_context_length: 32768 }],
			}),
		})

		const result = await mockFetchForTesting(fetchStub as any, () =>
			getLmStudioModels(
				{} as any,
				{
					baseUrl: "http://localhost:1234",
					apiKey: "lmstudio-secret",
				} as any,
			),
		)

		expect(result).to.deep.equal(
			StringArray.create({
				values: [JSON.stringify({ id: "qwen/qwen3", max_context_length: 32768 })],
			}),
		)
		sinon.assert.calledOnce(fetchStub)
		expect(fetchStub.firstCall.args[0]).to.equal("http://localhost:1234/api/v0/models")
		expect(fetchStub.firstCall.args[1]).to.deep.equal({
			headers: { Authorization: "Bearer lmstudio-secret" },
		})
	})

	it("omits the authorization header when no LM Studio API key is configured", async () => {
		const fetchStub = sinon.stub().resolves({
			json: async () => ({
				data: [{ id: "local-model", max_context_length: 8192 }],
			}),
		})

		const result = await mockFetchForTesting(fetchStub as any, () =>
			getLmStudioModels(
				{} as any,
				{
					baseUrl: "http://localhost:1234",
					apiKey: "",
				} as any,
			),
		)

		expect(result).to.deep.equal(
			StringArray.create({
				values: [JSON.stringify({ id: "local-model", max_context_length: 8192 })],
			}),
		)
		sinon.assert.calledOnce(fetchStub)
		expect(fetchStub.firstCall.args[0]).to.equal("http://localhost:1234/api/v0/models")
		expect(fetchStub.firstCall.args[1]).to.equal(undefined)
	})
})
