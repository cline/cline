import { describe, it, beforeEach, afterEach } from "mocha"
import { expect } from "chai"
import sinon from "sinon"
import axios from "axios"
import { Controller } from "../../../core/controller"
import { refreshGroqModels } from "../../../core/controller/models/refreshGroqModels"
import { EmptyRequest } from "../../../shared/proto/common"
import { groqModels } from "../../../shared/api"
import * as stateModule from "../../../core/storage/state"
import * as fsModule from "../../../utils/fs"
import fs from "fs/promises"

describe("Groq Dynamic Model Discovery", () => {
	let controller: Controller
	let axiosGetStub: sinon.SinonStub
	let consoleLogStub: sinon.SinonStub
	let consoleErrorStub: sinon.SinonStub
	let getAllExtensionStateStub: sinon.SinonStub
	let fileExistsStub: sinon.SinonStub
	let fsReadFileStub: sinon.SinonStub
	let fsWriteFileStub: sinon.SinonStub
	let fsMkdirStub: sinon.SinonStub

	beforeEach(() => {
		// Create a mock controller with minimal required properties
		controller = {
			context: {
				globalStorageUri: {
					fsPath: "/tmp/test-storage",
				},
			},
		} as any

		// Stub axios.get
		axiosGetStub = sinon.stub(axios, "get")

		// Stub console methods to reduce noise in tests
		consoleLogStub = sinon.stub(console, "log")
		consoleErrorStub = sinon.stub(console, "error")

		// Stub state module functions
		getAllExtensionStateStub = sinon.stub(stateModule, "getAllExtensionState")

		// Stub file system functions
		fileExistsStub = sinon.stub(fsModule, "fileExistsAtPath").resolves(false)
		fsReadFileStub = sinon.stub(fs, "readFile").resolves("{}")
		fsWriteFileStub = sinon.stub(fs, "writeFile").resolves()
		fsMkdirStub = sinon.stub(fs, "mkdir").resolves()
	})

	afterEach(() => {
		sinon.restore()
	})

	it("should filter out non-chat models", async () => {
		const mockApiResponse = {
			data: {
				data: [
					{
						id: "whisper-large-v3",
						object: "model",
						owned_by: "openai",
					},
					{
						id: "llama-guard-3-8b",
						object: "model",
						owned_by: "meta",
					},
					{
						id: "tts-1",
						object: "model",
						owned_by: "openai",
					},
					{
						id: "text-embedding-ada-002",
						object: "model",
						owned_by: "openai",
					},
					{
						id: "llama-3.3-70b-versatile",
						object: "model",
						owned_by: "meta",
						context_window: 131072,
						max_completion_tokens: 32768,
					},
				],
			},
		}

		axiosGetStub.resolves(mockApiResponse)

		getAllExtensionStateStub.resolves({
			apiConfiguration: {
				groqApiKey: "gsk_test_key_123",
			},
		})

		const result = await refreshGroqModels(controller, EmptyRequest.create({}))

		// Should only include the chat model
		expect(result.models).to.have.property("llama-3.3-70b-versatile")

		// Should not include filtered models
		expect(result.models).to.not.have.property("whisper-large-v3")
		expect(result.models).to.not.have.property("llama-guard-3-8b")
		expect(result.models).to.not.have.property("tts-1")
		expect(result.models).to.not.have.property("text-embedding-ada-002")
	})

	it("should detect image support for vision models", async () => {
		const mockApiResponse = {
			data: {
				data: [
					{
						id: "llama-4-maverick-vision",
						object: "model",
						owned_by: "meta",
						context_window: 131072,
						max_completion_tokens: 8192,
					},
					{
						id: "gpt-4-vision-preview",
						object: "model",
						owned_by: "openai",
						context_window: 128000,
						max_completion_tokens: 4096,
					},
					{
						id: "regular-text-model",
						object: "model",
						owned_by: "test",
						context_window: 8192,
						max_completion_tokens: 4096,
					},
				],
			},
		}

		axiosGetStub.resolves(mockApiResponse)

		getAllExtensionStateStub.resolves({
			apiConfiguration: {
				groqApiKey: "gsk_test_key_123",
			},
		})

		const result = await refreshGroqModels(controller, EmptyRequest.create({}))

		// Vision models should support images
		expect(result.models["llama-4-maverick-vision"].supportsImages).to.be.true
		expect(result.models["gpt-4-vision-preview"].supportsImages).to.be.true

		// Regular model should not support images
		expect(result.models["regular-text-model"].supportsImages).to.be.false
	})

	it("should handle API errors gracefully and fall back to static models", async () => {
		// Simulate API error
		axiosGetStub.rejects(new Error("Network error"))

		getAllExtensionStateStub.resolves({
			apiConfiguration: {
				groqApiKey: "gsk_test_key_123",
			},
		})

		const result = await refreshGroqModels(controller, EmptyRequest.create({}))

		// Should fall back to static models
		expect(Object.keys(result.models).length).to.be.greaterThan(0)

		// Should include known static models
		expect(result.models).to.have.property("llama-3.3-70b-versatile")
		expect(result.models).to.have.property("llama-3.1-8b-instant")

		// Verify error was logged
		expect(consoleErrorStub.calledWith("Error fetching Groq models:")).to.be.true
	})

	it("should estimate pricing for unknown model types", async () => {
		const mockApiResponse = {
			data: {
				data: [
					{
						id: "new-70b-model",
						object: "model",
						owned_by: "test",
						context_window: 32768,
						max_completion_tokens: 8192,
					},
					{
						id: "new-8b-model",
						object: "model",
						owned_by: "test",
						context_window: 16384,
						max_completion_tokens: 4096,
					},
					{
						id: "unknown-size-model",
						object: "model",
						owned_by: "test",
						context_window: 8192,
						max_completion_tokens: 2048,
					},
				],
			},
		}

		axiosGetStub.resolves(mockApiResponse)

		getAllExtensionStateStub.resolves({
			apiConfiguration: {
				groqApiKey: "gsk_test_key_123",
			},
		})

		const result = await refreshGroqModels(controller, EmptyRequest.create({}))

		// 70B model should have higher pricing
		expect(result.models["new-70b-model"].inputPrice).to.equal(0.59)
		expect(result.models["new-70b-model"].outputPrice).to.equal(0.79)

		// 8B model should have lower pricing
		expect(result.models["new-8b-model"].inputPrice).to.equal(0.05)
		expect(result.models["new-8b-model"].outputPrice).to.equal(0.08)

		// Unknown size should use default pricing
		expect(result.models["unknown-size-model"].inputPrice).to.equal(0.2)
		expect(result.models["unknown-size-model"].outputPrice).to.equal(0.2)
	})

	it("should handle missing API key", async () => {
		getAllExtensionStateStub.resolves({
			apiConfiguration: {
				// No groqApiKey provided
			},
		})

		const result = await refreshGroqModels(controller, EmptyRequest.create({}))

		// Should fall back to static models when no API key
		expect(Object.keys(result.models).length).to.be.greaterThan(0)
		expect(result.models).to.have.property("llama-3.3-70b-versatile")

		// Should log error about missing API key
		expect(consoleErrorStub.calledWith("Error fetching Groq models:")).to.be.true
	})
})
