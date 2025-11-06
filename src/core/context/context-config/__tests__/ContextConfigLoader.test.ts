import { expect } from "chai"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { DEFAULT_CONFIG } from "../ContextConfig"
import { ContextConfigLoader } from "../ContextConfigLoader"

describe("ContextConfigLoader", () => {
	let loader: ContextConfigLoader
	let tempDir: string

	beforeEach(async () => {
		loader = new ContextConfigLoader()
		// Create a unique temp directory for each test
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-context-test-"))
	})

	afterEach(async () => {
		// Clean up temp directory
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	describe("loadConfig", () => {
		it("should return DEFAULT_CONFIG when no config file exists", async () => {
			const config = await loader.loadConfig(tempDir)
			expect(config).to.deep.equal(DEFAULT_CONFIG)
		})

		it("should load valid .clinecontext file", async () => {
			const configContent = JSON.stringify({
				includeVisibleFiles: false,
				includeOpenTabs: true,
				includeFileTree: false,
				fileTreeStyle: "flat",
				workdir: {
					maxFileCount: 100,
					includePatterns: ["src/**"],
					excludePatterns: ["node_modules/**"],
				},
			})

			await fs.writeFile(path.join(tempDir, ".clinecontext"), configContent)

			const config = await loader.loadConfig(tempDir)

			expect(config.includeVisibleFiles).to.equal(false)
			expect(config.includeOpenTabs).to.equal(true)
			expect(config.includeFileTree).to.equal(false)
			expect(config.fileTreeStyle).to.equal("flat")
			expect(config.workdir.maxFileCount).to.equal(100)
			expect(config.workdir.includePatterns).to.deep.equal(["src/**"])
			expect(config.workdir.excludePatterns).to.deep.equal(["node_modules/**"])
		})

		it("should load valid .clinecontext.json file", async () => {
			const configContent = JSON.stringify({
				includeVisibleFiles: false,
				fileTreeStyle: "none",
			})

			await fs.writeFile(path.join(tempDir, ".clinecontext.json"), configContent)

			const config = await loader.loadConfig(tempDir)

			expect(config.includeVisibleFiles).to.equal(false)
			expect(config.fileTreeStyle).to.equal("none")
		})

		it("should prefer .clinecontext over .clinecontext.json", async () => {
			await fs.writeFile(path.join(tempDir, ".clinecontext"), JSON.stringify({ includeVisibleFiles: false }))
			await fs.writeFile(path.join(tempDir, ".clinecontext.json"), JSON.stringify({ includeVisibleFiles: true }))

			const config = await loader.loadConfig(tempDir)

			expect(config.includeVisibleFiles).to.equal(false)
		})

		it("should strip // comments from config", async () => {
			const configContent = `{
  // This is a comment
  "includeVisibleFiles": false, // inline comment
  "includeOpenTabs": true,
  // Another comment
  "fileTreeStyle": "flat"
}`

			await fs.writeFile(path.join(tempDir, ".clinecontext"), configContent)

			const config = await loader.loadConfig(tempDir)

			expect(config.includeVisibleFiles).to.equal(false)
			expect(config.includeOpenTabs).to.equal(true)
			expect(config.fileTreeStyle).to.equal("flat")
		})

		it("should preserve // in URLs within strings", async () => {
			const configContent = `{
  "includeVisibleFiles": true,
  "workdir": {
    "includePatterns": ["https://example.com/**"]
  }
}`

			await fs.writeFile(path.join(tempDir, ".clinecontext"), configContent)

			const config = await loader.loadConfig(tempDir)

			expect(config.workdir.includePatterns).to.deep.equal(["https://example.com/**"])
		})

		it("should handle invalid JSON gracefully", async () => {
			const configContent = "{ invalid json }"

			await fs.writeFile(path.join(tempDir, ".clinecontext"), configContent)

			const config = await loader.loadConfig(tempDir)

			expect(config).to.deep.equal(DEFAULT_CONFIG)
		})

		it("should merge partial config with defaults", async () => {
			const configContent = JSON.stringify({
				includeVisibleFiles: false,
			})

			await fs.writeFile(path.join(tempDir, ".clinecontext"), configContent)

			const config = await loader.loadConfig(tempDir)

			expect(config.includeVisibleFiles).to.equal(false)
			expect(config.includeOpenTabs).to.equal(DEFAULT_CONFIG.includeOpenTabs)
			expect(config.includeFileTree).to.equal(DEFAULT_CONFIG.includeFileTree)
			expect(config.fileTreeStyle).to.equal(DEFAULT_CONFIG.fileTreeStyle)
			expect(config.workdir).to.deep.equal(DEFAULT_CONFIG.workdir)
		})

		it("should merge partial workdir config with defaults", async () => {
			const configContent = JSON.stringify({
				workdir: {
					maxFileCount: 50,
				},
			})

			await fs.writeFile(path.join(tempDir, ".clinecontext"), configContent)

			const config = await loader.loadConfig(tempDir)

			expect(config.workdir.maxFileCount).to.equal(50)
			expect(config.workdir.includePatterns).to.deep.equal(DEFAULT_CONFIG.workdir.includePatterns)
			expect(config.workdir.excludePatterns).to.deep.equal(DEFAULT_CONFIG.workdir.excludePatterns)
		})

		it("should cache loaded config", async () => {
			const configContent = JSON.stringify({ includeVisibleFiles: false })
			await fs.writeFile(path.join(tempDir, ".clinecontext"), configContent)

			const config1 = await loader.loadConfig(tempDir)
			const config2 = await loader.loadConfig(tempDir)

			expect(config1).to.equal(config2) // Same object reference
		})

		it("should cache DEFAULT_CONFIG when no file exists", async () => {
			const config1 = await loader.loadConfig(tempDir)
			const config2 = await loader.loadConfig(tempDir)

			expect(config1).to.equal(config2) // Same object reference
		})
	})

	describe("clearCache", () => {
		it("should clear all cached configs", async () => {
			const configContent = JSON.stringify({ includeVisibleFiles: false })
			await fs.writeFile(path.join(tempDir, ".clinecontext"), configContent)

			const config1 = await loader.loadConfig(tempDir)
			loader.clearCache()
			const config2 = await loader.loadConfig(tempDir)

			expect(config1).to.not.equal(config2) // Different object references
			expect(config1).to.deep.equal(config2) // But same values
		})
	})

	describe("clearCacheForWorkspace", () => {
		it("should clear cache for specific workspace", async () => {
			const configContent = JSON.stringify({ includeVisibleFiles: false })
			await fs.writeFile(path.join(tempDir, ".clinecontext"), configContent)

			const config1 = await loader.loadConfig(tempDir)
			loader.clearCacheForWorkspace(tempDir)
			const config2 = await loader.loadConfig(tempDir)

			expect(config1).to.not.equal(config2) // Different object references
			expect(config1).to.deep.equal(config2) // But same values
		})

		it("should not affect other workspace caches", async () => {
			const tempDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "cline-context-test-2-"))

			try {
				await fs.writeFile(path.join(tempDir, ".clinecontext"), JSON.stringify({ includeVisibleFiles: false }))
				await fs.writeFile(path.join(tempDir2, ".clinecontext"), JSON.stringify({ includeVisibleFiles: true }))

				const config1 = await loader.loadConfig(tempDir)
				const config2a = await loader.loadConfig(tempDir2)

				loader.clearCacheForWorkspace(tempDir)

				const config2b = await loader.loadConfig(tempDir2)

				expect(config2a).to.equal(config2b) // Same object reference (still cached)
				expect(config1.includeVisibleFiles).to.equal(false)
				expect(config2a.includeVisibleFiles).to.equal(true)
			} finally {
				await fs.rm(tempDir2, { recursive: true, force: true })
			}
		})
	})

	describe("comment stripping edge cases", () => {
		it("should handle escaped quotes in strings", async () => {
			const configContent = `{
  "workdir": {
    "includePatterns": ["path/with\\"quote/**"]
  }
}`

			await fs.writeFile(path.join(tempDir, ".clinecontext"), configContent)

			const config = await loader.loadConfig(tempDir)

			expect(config.workdir.includePatterns).to.deep.equal(['path/with"quote/**'])
		})

		it("should handle multiple // in a line", async () => {
			const configContent = `{
  "includeVisibleFiles": true // comment // with // multiple // slashes
}`

			await fs.writeFile(path.join(tempDir, ".clinecontext"), configContent)

			const config = await loader.loadConfig(tempDir)

			expect(config.includeVisibleFiles).to.equal(true)
		})

		it("should handle empty lines and whitespace", async () => {
			const configContent = `{

  // Comment with whitespace
  "includeVisibleFiles": false,

  "includeOpenTabs": true

}`

			await fs.writeFile(path.join(tempDir, ".clinecontext"), configContent)

			const config = await loader.loadConfig(tempDir)

			expect(config.includeVisibleFiles).to.equal(false)
			expect(config.includeOpenTabs).to.equal(true)
		})
	})
})
