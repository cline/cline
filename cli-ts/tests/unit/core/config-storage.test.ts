import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import {
	ConfigStorage,
	createConfigStorage,
	isValidConfigKey,
	parseConfigValue,
	VALID_CONFIG_KEYS,
} from "../../../src/core/config-storage.js"

describe("ConfigStorage", () => {
	let tempDir: string
	let storage: ConfigStorage

	beforeEach(() => {
		// Create a temporary directory for tests
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-test-"))
		storage = new ConfigStorage(tempDir)
	})

	afterEach(() => {
		// Clean up temp directory
		try {
			fs.rmSync(tempDir, { recursive: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	describe("load", () => {
		it("should return empty object when config file does not exist", () => {
			const config = storage.load()
			expect(config).to.deep.equal({})
		})

		it("should load existing config from file", () => {
			const testConfig = { outputFormat: "json", defaultModel: "claude-3" }
			fs.mkdirSync(tempDir, { recursive: true })
			fs.writeFileSync(path.join(tempDir, "config.json"), JSON.stringify(testConfig))

			const config = storage.load()
			expect(config).to.deep.equal(testConfig)
		})

		it("should return empty object on invalid JSON", () => {
			fs.mkdirSync(tempDir, { recursive: true })
			fs.writeFileSync(path.join(tempDir, "config.json"), "not valid json")

			const config = storage.load()
			expect(config).to.deep.equal({})
		})
	})

	describe("save", () => {
		it("should create config directory if it does not exist", () => {
			const nestedDir = path.join(tempDir, "nested", "config")
			const nestedStorage = new ConfigStorage(nestedDir)

			nestedStorage.save({ testKey: "testValue" })

			expect(fs.existsSync(path.join(nestedDir, "config.json"))).to.be.true
		})

		it("should save config as formatted JSON", () => {
			storage.save({ outputFormat: "rich", autoApprove: true })

			const content = fs.readFileSync(path.join(tempDir, "config.json"), "utf-8")
			const parsed = JSON.parse(content)

			expect(parsed.outputFormat).to.equal("rich")
			expect(parsed.autoApprove).to.be.true
		})
	})

	describe("get", () => {
		it("should return undefined for non-existent key", () => {
			expect(storage.get("nonExistent")).to.be.undefined
		})

		it("should return value for existing key", () => {
			storage.save({ myKey: "myValue" })
			expect(storage.get("myKey")).to.equal("myValue")
		})
	})

	describe("set", () => {
		it("should set a new key", () => {
			storage.set("newKey", "newValue")
			expect(storage.get("newKey")).to.equal("newValue")
		})

		it("should update an existing key", () => {
			storage.set("key", "value1")
			storage.set("key", "value2")
			expect(storage.get("key")).to.equal("value2")
		})

		it("should preserve other keys when setting", () => {
			storage.set("key1", "value1")
			storage.set("key2", "value2")
			expect(storage.get("key1")).to.equal("value1")
			expect(storage.get("key2")).to.equal("value2")
		})
	})

	describe("delete", () => {
		it("should return false when key does not exist", () => {
			expect(storage.delete("nonExistent")).to.be.false
		})

		it("should delete existing key and return true", () => {
			storage.set("toDelete", "value")
			expect(storage.delete("toDelete")).to.be.true
			expect(storage.get("toDelete")).to.be.undefined
		})

		it("should preserve other keys when deleting", () => {
			storage.set("key1", "value1")
			storage.set("key2", "value2")
			storage.delete("key1")
			expect(storage.get("key2")).to.equal("value2")
		})
	})

	describe("list", () => {
		it("should return empty object when no config", () => {
			expect(storage.list()).to.deep.equal({})
		})

		it("should return all config values", () => {
			storage.set("key1", "value1")
			storage.set("key2", "value2")
			expect(storage.list()).to.deep.equal({ key1: "value1", key2: "value2" })
		})
	})

	describe("clear", () => {
		it("should remove all config values", () => {
			storage.set("key1", "value1")
			storage.set("key2", "value2")
			storage.clear()
			expect(storage.list()).to.deep.equal({})
		})
	})

	describe("getConfigPath", () => {
		it("should return the path to config.json", () => {
			expect(storage.getConfigPath()).to.equal(path.join(tempDir, "config.json"))
		})
	})
})

describe("createConfigStorage", () => {
	it("should create a ConfigStorage instance", () => {
		const storage = createConfigStorage("/tmp/test")
		expect(storage).to.be.instanceOf(ConfigStorage)
	})
})

describe("isValidConfigKey", () => {
	it("should return true for valid keys", () => {
		for (const key of VALID_CONFIG_KEYS) {
			expect(isValidConfigKey(key)).to.be.true
		}
	})

	it("should return false for invalid keys", () => {
		expect(isValidConfigKey("invalidKey")).to.be.false
		expect(isValidConfigKey("")).to.be.false
		expect(isValidConfigKey("OUTPUTFORMAT")).to.be.false
	})
})

describe("parseConfigValue", () => {
	describe("autoApprove (boolean)", () => {
		it("should parse 'true' as true", () => {
			expect(parseConfigValue("autoApprove", "true")).to.be.true
		})

		it("should parse '1' as true", () => {
			expect(parseConfigValue("autoApprove", "1")).to.be.true
		})

		it("should parse 'yes' as true", () => {
			expect(parseConfigValue("autoApprove", "yes")).to.be.true
		})

		it("should parse 'false' as false", () => {
			expect(parseConfigValue("autoApprove", "false")).to.be.false
		})

		it("should parse '0' as false", () => {
			expect(parseConfigValue("autoApprove", "0")).to.be.false
		})

		it("should parse 'no' as false", () => {
			expect(parseConfigValue("autoApprove", "no")).to.be.false
		})

		it("should throw on invalid boolean", () => {
			expect(() => parseConfigValue("autoApprove", "invalid")).to.throw("Invalid boolean value")
		})
	})

	describe("outputFormat", () => {
		it("should accept 'rich'", () => {
			expect(parseConfigValue("outputFormat", "rich")).to.equal("rich")
		})

		it("should accept 'json'", () => {
			expect(parseConfigValue("outputFormat", "json")).to.equal("json")
		})

		it("should accept 'plain'", () => {
			expect(parseConfigValue("outputFormat", "plain")).to.equal("plain")
		})

		it("should throw on invalid format", () => {
			expect(() => parseConfigValue("outputFormat", "invalid")).to.throw("Invalid output format")
		})
	})

	describe("string values", () => {
		it("should return string values as-is", () => {
			expect(parseConfigValue("defaultModel", "gpt-4")).to.equal("gpt-4")
			expect(parseConfigValue("defaultProvider", "openai")).to.equal("openai")
		})
	})
})
