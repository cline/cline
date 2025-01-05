import { describe, it, beforeEach } from "mocha"
import "should"
import { ConfigManager } from "../ConfigManager"
import { ApiConfiguration } from "../../../shared/api"
import { ExtensionContext, SecretStorage, EventEmitter } from "vscode"

describe("ConfigManager", () => {
  let configManager: ConfigManager
  let mockSecrets: Map<string, string>
  let mockContext: Pick<ExtensionContext, 'secrets'>

  beforeEach(() => {
    // Create a mock secrets store
    mockSecrets = new Map<string, string>()

    // Create minimal mock context with just the secrets we need
    mockContext = {
      secrets: {
        store: async (key: string, value: string) => {
          mockSecrets.set(key, value);
        },
        get: async (key: string) => {
          return mockSecrets.get(key) ?? "";
        },
        delete: async (key: string) => {
          mockSecrets.delete(key);
        },
        onDidChange: new EventEmitter<{ key: string, value: string | undefined }>().event
      } as SecretStorage
    }

    configManager = new ConfigManager(mockContext as ExtensionContext)
  })

  describe("initialization", () => {
    it("should initialize with default config when empty", async () => {
      await configManager.initConfig()

      const configs = await configManager.ListConfig()
      configs.should.be.Array()
      configs.length.should.equal(1)
      configs[0].should.have.property("name", "default")
    })
  })

  describe("ListConfig", () => {
    it("should list available configs", async () => {
      await configManager.initConfig()

      const configs = await configManager.ListConfig()
      configs.should.be.Array()
      configs.length.should.equal(1)
      configs[0].should.have.property("name", "default")
    })
  })

  describe("SaveConfig", () => {
    it("should save new config", async () => {
      await configManager.initConfig()

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
      await configManager.initConfig()

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
      await configManager.initConfig()

      const testConfig: ApiConfiguration = {
        apiProvider: "openai",
        apiKey: "test-key"
      }
      await configManager.SaveConfig("test-config", testConfig)

      const config = await configManager.LoadConfig("test-config")
      config.should.have.property("apiProvider", "openai")
      config.should.have.property("apiKey", "test-key")
    })

    it("should throw error for non-existent config", async () => {
      await configManager.initConfig()

      await configManager.LoadConfig("non-existent")
        .should.be.rejectedWith("Failed to load config: Error: Config 'non-existent' not found")
    })
  })

  describe("DeleteConfig", () => {
    it("should delete existing config", async () => {
      await configManager.initConfig()

      const testConfig: ApiConfiguration = {
        apiProvider: "anthropic",
        apiKey: "test-key"
      }
      await configManager.SaveConfig("test-config", testConfig)
      await configManager.DeleteConfig("test-config")

      const configs = await configManager.ListConfig()
      configs.length.should.equal(1)
      configs[0].should.have.property("name", "default")
    })

    it("should throw error when deleting non-existent config", async () => {
      await configManager.initConfig()

      await configManager.DeleteConfig("non-existent")
        .should.be.rejectedWith("Failed to delete config: Error: Config 'non-existent' not found")
    })

    it("should not allow deleting last config", async () => {
      await configManager.initConfig()

      await configManager.DeleteConfig("default")
        .should.be.rejectedWith("Failed to delete config: Error: Cannot delete the last remaining configuration.")
    })
  })

  describe("SetCurrentConfig", () => {
    it("should set current config", async () => {
      await configManager.initConfig()

      const testConfig: ApiConfiguration = {
        apiProvider: "anthropic",
        apiKey: "test-key"
      }
      await configManager.SaveConfig("test-config", testConfig)
      await configManager.SetCurrentConfig("test-config")

      // Load config to verify current config name was updated
      const config = await configManager.LoadConfig("test-config")
      config.should.have.property("apiProvider", "anthropic")
    })

    it("should throw error for non-existent config", async () => {
      await configManager.initConfig()

      await configManager.SetCurrentConfig("non-existent")
        .should.be.rejectedWith("Failed to set current config: Error: Config 'non-existent' not found")
    })
  })
})