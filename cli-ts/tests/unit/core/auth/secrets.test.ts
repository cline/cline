import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import { createSecretsStorage, maskApiKey, SecretsStorage } from "../../../../src/core/auth/secrets.js"

describe("SecretsStorage", () => {
	let tempDir: string
	let storage: SecretsStorage

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-secrets-test-"))
		storage = new SecretsStorage(tempDir)
	})

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	describe("load", () => {
		it("should return empty object when secrets file does not exist", () => {
			const secrets = storage.load()
			expect(secrets).to.deep.equal({})
		})

		it("should load existing secrets from file", () => {
			const testSecrets = { anthropic: "sk-ant-123", openai: "sk-456" }
			fs.mkdirSync(tempDir, { recursive: true })
			fs.writeFileSync(path.join(tempDir, "secrets.json"), JSON.stringify(testSecrets))

			const secrets = storage.load()
			expect(secrets).to.deep.equal(testSecrets)
		})

		it("should return empty object on invalid JSON", () => {
			fs.mkdirSync(tempDir, { recursive: true })
			fs.writeFileSync(path.join(tempDir, "secrets.json"), "not valid json")

			const secrets = storage.load()
			expect(secrets).to.deep.equal({})
		})
	})

	describe("save", () => {
		it("should create secrets directory if it does not exist", () => {
			const nestedDir = path.join(tempDir, "nested", "secrets")
			const nestedStorage = new SecretsStorage(nestedDir)

			nestedStorage.save({ testProvider: "test-key" })

			expect(fs.existsSync(path.join(nestedDir, "secrets.json"))).to.be.true
		})

		it("should save secrets as formatted JSON", () => {
			storage.save({ anthropic: "sk-ant-123" })

			const content = fs.readFileSync(path.join(tempDir, "secrets.json"), "utf-8")
			const parsed = JSON.parse(content)

			expect(parsed.anthropic).to.equal("sk-ant-123")
		})
	})

	describe("getApiKey", () => {
		it("should return undefined for non-existent provider", () => {
			expect(storage.getApiKey("nonexistent")).to.be.undefined
		})

		it("should return API key for existing provider", () => {
			storage.save({ anthropic: "sk-ant-123" })
			expect(storage.getApiKey("anthropic")).to.equal("sk-ant-123")
		})
	})

	describe("setApiKey", () => {
		it("should set API key for new provider", () => {
			storage.setApiKey("anthropic", "sk-ant-123")
			expect(storage.getApiKey("anthropic")).to.equal("sk-ant-123")
		})

		it("should update API key for existing provider", () => {
			storage.setApiKey("anthropic", "old-key")
			storage.setApiKey("anthropic", "new-key")
			expect(storage.getApiKey("anthropic")).to.equal("new-key")
		})

		it("should preserve other keys when setting", () => {
			storage.setApiKey("anthropic", "sk-ant-123")
			storage.setApiKey("openai", "sk-456")
			expect(storage.getApiKey("anthropic")).to.equal("sk-ant-123")
			expect(storage.getApiKey("openai")).to.equal("sk-456")
		})
	})

	describe("deleteApiKey", () => {
		it("should return false when provider does not exist", () => {
			expect(storage.deleteApiKey("nonexistent")).to.be.false
		})

		it("should delete existing key and return true", () => {
			storage.setApiKey("anthropic", "sk-ant-123")
			expect(storage.deleteApiKey("anthropic")).to.be.true
			expect(storage.getApiKey("anthropic")).to.be.undefined
		})

		it("should preserve other keys when deleting", () => {
			storage.setApiKey("anthropic", "sk-ant-123")
			storage.setApiKey("openai", "sk-456")
			storage.deleteApiKey("anthropic")
			expect(storage.getApiKey("openai")).to.equal("sk-456")
		})
	})

	describe("listProviders", () => {
		it("should return empty array when no secrets", () => {
			expect(storage.listProviders()).to.deep.equal([])
		})

		it("should return array of provider ids", () => {
			storage.setApiKey("anthropic", "sk-ant-123")
			storage.setApiKey("openai", "sk-456")
			const providers = storage.listProviders()
			expect(providers).to.include("anthropic")
			expect(providers).to.include("openai")
		})
	})

	describe("hasApiKey", () => {
		it("should return false when provider has no key", () => {
			expect(storage.hasApiKey("anthropic")).to.be.false
		})

		it("should return true when provider has key", () => {
			storage.setApiKey("anthropic", "sk-ant-123")
			expect(storage.hasApiKey("anthropic")).to.be.true
		})
	})

	describe("getSecretsPath", () => {
		it("should return path to secrets.json", () => {
			expect(storage.getSecretsPath()).to.equal(path.join(tempDir, "secrets.json"))
		})
	})

	describe("clear", () => {
		it("should remove all secrets", () => {
			storage.setApiKey("anthropic", "sk-ant-123")
			storage.setApiKey("openai", "sk-456")
			storage.clear()
			expect(storage.listProviders()).to.deep.equal([])
		})
	})
})

describe("createSecretsStorage", () => {
	it("should create a SecretsStorage instance", () => {
		const storage = createSecretsStorage("/tmp/test")
		expect(storage).to.be.instanceOf(SecretsStorage)
	})
})

describe("maskApiKey", () => {
	it("should mask long keys showing first/last 4 chars", () => {
		expect(maskApiKey("sk-ant-api0123456789abcd")).to.equal("sk-a...abcd")
	})

	it("should return **** for short keys", () => {
		expect(maskApiKey("short")).to.equal("****")
		expect(maskApiKey("12345678")).to.equal("****")
	})

	it("should handle keys just over threshold", () => {
		expect(maskApiKey("123456789")).to.equal("1234...6789")
	})
})
