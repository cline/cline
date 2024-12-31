import * as fs from "fs/promises"
import { after, before, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import "should"
import { ConfigManager } from "../ConfigManager"
import { ApiConfiguration } from "../../../shared/api"

describe("ConfigManager", () => {
  const tmpDir = path.join(os.tmpdir(), "cline-config-test-" + Math.random().toString(36).slice(2))
  let configManager: ConfigManager

  before(async () => {
    configManager = new ConfigManager(tmpDir)
  })

  // Clean up after tests
  after(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("initialization", () => {
    it("should create config directory and file", async () => {
      const configPath = path.join(tmpDir, "api-config.json")
      const exists = await fs.access(configPath).then(() => true).catch(() => false)
      exists.should.be.true()

      const content = await fs.readFile(configPath, "utf-8")
      const config = JSON.parse(content)
      config.should.have.property("currentApiConfigName", "default")
      config.should.have.property("apiConfigs")
      config.apiConfigs.should.have.property("default")
    })
  })

  describe("ListConfig", () => {
    it("should list available configs", async () => {
      const configs = await configManager.ListConfig()
      configs.should.be.Array()
      configs.length.should.equal(1)
      configs[0].should.have.property("name", "default")
    })
  })

  describe("SaveConfig", () => {
    it("should save new config", async () => {
      const testConfig: ApiConfiguration = {
        apiProvider: "anthropic",
        apiKey: "test-key"
      }

      await configManager.SaveConfig("test-config", testConfig)
      
      const configs = await configManager.ListConfig()
      configs.length.should.equal(2)
      const savedConfig = configs.find(c => c.name === "test-config")
      savedConfig?.should.have.property("apiProvider", "anthropic")
    })

    it("should update existing config", async () => {
      const updatedConfig: ApiConfiguration = {
        apiProvider: "openai",
        apiKey: "updated-key"
      }

      await configManager.SaveConfig("test-config", updatedConfig)
      
      const configs = await configManager.ListConfig()
      const savedConfig = configs.find(c => c.name === "test-config")
      savedConfig?.should.have.property("apiProvider", "openai")
    })
  })

  describe("LoadConfig", () => {
    it("should load existing config", async () => {
      const config = await configManager.LoadConfig("test-config")
      config.should.have.property("apiProvider", "openai")
      config.should.have.property("apiKey", "updated-key")
    })

    it("should throw error for non-existent config", async () => {
      await configManager.LoadConfig("non-existent")
        .should.be.rejectedWith("Failed to load config: Error: Config 'non-existent' not found")
    })
  })

  describe("DeleteConfig", () => {
    it("should delete existing config", async () => {
      await configManager.DeleteConfig("test-config")
      
      const configs = await configManager.ListConfig()
      configs.length.should.equal(1)
      configs[0].should.have.property("name", "default")
    })

    it("should throw error when deleting non-existent config", async () => {
      await configManager.DeleteConfig("non-existent")
        .should.be.rejectedWith("Failed to delete config: Error: Config 'non-existent' not found")
    })

    it("should not allow deleting last config", async () => {
      await configManager.DeleteConfig("default")
        .should.be.rejectedWith("Failed to delete config: Error: Cannot delete the last remaining configuration.")
    })
  })

  describe("SetCurrentConfig", () => {
    it("should set current config", async () => {
      // First save a new config
      const testConfig: ApiConfiguration = {
        apiProvider: "anthropic",
        apiKey: "test-key"
      }
      await configManager.SaveConfig("test-config", testConfig)

      // Then set it as current
      await configManager.SetCurrentConfig("test-config")

      // Verify by reading the file directly
      const configPath = path.join(tmpDir, "api-config.json")
      const content = await fs.readFile(configPath, "utf-8")
      const config = JSON.parse(content)
      config.should.have.property("currentApiConfigName", "test-config")
    })

    it("should throw error for non-existent config", async () => {
      await configManager.SetCurrentConfig("non-existent")
        .should.be.rejectedWith("Failed to set current config: Error: Config 'non-existent' not found")
    })
  })
})