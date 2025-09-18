/**
 * Tests for HookConfigurationLoader
 */

import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import * as sinon from "sinon"
import { HookConfigurationLoader } from "./HookConfiguration"

describe("HookConfigurationLoader", () => {
	let loader: HookConfigurationLoader
	let sandbox: sinon.SinonSandbox
	const testProjectRoot = "/project/root"

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("getConfiguration", () => {
		beforeEach(() => {
			loader = new HookConfigurationLoader(testProjectRoot)
		})

		it("should load project configuration when available", async () => {
			const mockConfig = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [
								{
									type: "command",
									command: "node hook.js",
								},
							],
						},
					],
				},
			}

			// Stub stat calls
			const statStub = sandbox.stub(fs, "stat")
			const globalPath = path.join(os.homedir(), ".cline", "settings.json")
			const projectPath = path.join(testProjectRoot, ".cline", "settings.json")
			statStub.withArgs(globalPath).rejects({ code: "ENOENT" } as any)
			statStub.withArgs(projectPath).resolves({ mtimeMs: 1234567890 } as any)

			// Stub readFile calls
			const readFileStub = sandbox.stub(fs, "readFile")
			readFileStub.withArgs(projectPath).resolves(JSON.stringify(mockConfig))

			const config = await loader.getConfiguration()

			expect(config).to.deep.equal(mockConfig)
		})

		it("should merge global and project configurations", async () => {
			const globalConfig = {
				hooks: {
					PreToolUse: [
						{
							matcher: "Read",
							hooks: [{ type: "command" as const, command: "global-hook.js" }],
						},
					],
				},
				settings: { parallel: false },
			}

			const projectConfig = {
				hooks: {
					PreToolUse: [
						{
							matcher: "Write",
							hooks: [{ type: "command" as const, command: "project-hook.js" }],
						},
					],
				},
				settings: { defaultTimeout: 30 },
			}

			// Stub stat calls
			const statStub = sandbox.stub(fs, "stat")
			const globalPath = path.join(os.homedir(), ".cline", "settings.json")
			const projectPath = path.join(testProjectRoot, ".cline", "settings.json")
			statStub.withArgs(globalPath).resolves({ mtimeMs: 1111111111 } as any)
			statStub.withArgs(projectPath).resolves({ mtimeMs: 2222222222 } as any)

			// Stub readFile calls
			const readFileStub = sandbox.stub(fs, "readFile")
			readFileStub.withArgs(globalPath).resolves(JSON.stringify(globalConfig))
			readFileStub.withArgs(projectPath).resolves(JSON.stringify(projectConfig))

			const config = await loader.getConfiguration()

			// Should have both hooks
			expect(config.hooks.PreToolUse).to.have.lengthOf(2)
			expect(config.hooks.PreToolUse![0].matcher).to.equal("Read")
			expect(config.hooks.PreToolUse![1].matcher).to.equal("Write")

			// Settings should merge with project taking precedence
			expect(config.settings?.parallel).to.equal(false)
			expect(config.settings?.defaultTimeout).to.equal(30)
		})

		it("should return default config if neither file exists", async () => {
			const error = new Error("ENOENT") as NodeJS.ErrnoException
			error.code = "ENOENT"
			sandbox.stub(fs, "stat").rejects(error)

			const config = await loader.getConfiguration()

			expect(config.hooks).to.deep.equal({})
			expect(config.settings?.defaultTimeout).to.equal(60)
		})

		it("should use only global config when project doesn't exist", async () => {
			const globalConfig = {
				hooks: {
					UserPromptSubmit: [
						{
							matcher: "*",
							hooks: [{ type: "command" as const, command: "global-prompt.js" }],
						},
					],
				},
			}

			// Stub stat calls
			const statStub = sandbox.stub(fs, "stat")
			const globalPath = path.join(os.homedir(), ".cline", "settings.json")
			const projectPath = path.join(testProjectRoot, ".cline", "settings.json")
			statStub.withArgs(globalPath).resolves({ mtimeMs: 1111111111 } as any)
			statStub.withArgs(projectPath).rejects({ code: "ENOENT" } as any)

			// Stub readFile calls
			const readFileStub = sandbox.stub(fs, "readFile")
			readFileStub.withArgs(globalPath).resolves(JSON.stringify(globalConfig))

			const config = await loader.getConfiguration()

			expect(config).to.deep.equal(globalConfig)
		})

		it("should return default config on parse error", async () => {
			// Stub stat calls
			const statStub = sandbox.stub(fs, "stat")
			const globalPath = path.join(os.homedir(), ".cline", "settings.json")
			const projectPath = path.join(testProjectRoot, ".cline", "settings.json")
			statStub.withArgs(globalPath).resolves({ mtimeMs: 1234567890 } as any)
			statStub.withArgs(projectPath).rejects({ code: "ENOENT" } as any)

			sandbox.stub(fs, "readFile").withArgs(globalPath).resolves("invalid json {")

			const config = await loader.getConfiguration()

			expect(config.hooks).to.deep.equal({})
		})
	})

	describe("saveConfiguration", () => {
		beforeEach(() => {
			loader = new HookConfigurationLoader(testProjectRoot)
		})

		it("should save configuration to project file by default", async () => {
			const config = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [{ type: "command" as const, command: "hook.js" }],
						},
					],
				},
			}

			const mkdirStub = sandbox.stub(fs, "mkdir").resolves(undefined)
			const writeFileStub = sandbox.stub(fs, "writeFile").resolves(undefined)

			await loader.saveConfiguration(config)

			const projectDir = path.join(testProjectRoot, ".cline")
			const projectSettingsPath = path.join(projectDir, "settings.json")
			expect(mkdirStub.calledWith(projectDir)).to.be.true
			expect(writeFileStub.calledWith(projectSettingsPath)).to.be.true
		})

		it("should save configuration to global file when specified", async () => {
			const config = {
				hooks: {
					PostToolUse: [
						{
							matcher: "*",
							hooks: [{ type: "command" as const, command: "global-hook.js" }],
						},
					],
				},
			}

			const mkdirStub = sandbox.stub(fs, "mkdir").resolves(undefined)
			const writeFileStub = sandbox.stub(fs, "writeFile").resolves(undefined)

			await loader.saveConfiguration(config, "global")

			const globalDir = path.join(os.homedir(), ".cline")
			const globalSettingsPath = path.join(globalDir, "settings.json")
			expect(mkdirStub.calledWith(globalDir)).to.be.true
			expect(writeFileStub.calledWith(globalSettingsPath)).to.be.true
		})
	})

	describe("hasHooks", () => {
		beforeEach(() => {
			loader = new HookConfigurationLoader(testProjectRoot)
		})

		it("should return true when hooks are configured", async () => {
			const statStub = sandbox.stub(fs, "stat")
			const globalPath = path.join(os.homedir(), ".cline", "settings.json")
			const projectPath = path.join(testProjectRoot, ".cline", "settings.json")
			statStub.withArgs(globalPath).rejects({ code: "ENOENT" } as any)
			statStub.withArgs(projectPath).resolves({ mtimeMs: 1234567890 } as any)

			sandbox
				.stub(fs, "readFile")
				.withArgs(projectPath)
				.resolves(
					JSON.stringify({
						hooks: {
							PreToolUse: [
								{
									matcher: "*",
									hooks: [{ type: "command", command: "hook.js" }],
								},
							],
						},
					}),
				)

			const result = await loader.hasHooks()
			expect(result).to.be.true
		})

		it("should return false when no hooks are configured", async () => {
			const statStub = sandbox.stub(fs, "stat")
			const globalPath = path.join(os.homedir(), ".cline", "settings.json")
			const projectPath = path.join(testProjectRoot, ".cline", "settings.json")
			statStub.withArgs(globalPath).rejects({ code: "ENOENT" } as any)
			statStub.withArgs(projectPath).resolves({ mtimeMs: 1234567890 } as any)

			sandbox
				.stub(fs, "readFile")
				.withArgs(projectPath)
				.resolves(
					JSON.stringify({
						hooks: {},
					}),
				)

			const result = await loader.hasHooks()
			expect(result).to.be.false
		})
	})

	describe("getConfigPaths", () => {
		it("should return both global and project config paths", () => {
			const loader = new HookConfigurationLoader(testProjectRoot)
			const paths = loader.getConfigPaths()
			expect(paths.global).to.equal(path.join(os.homedir(), ".cline", "settings.json"))
			expect(paths.project).to.equal(path.join(testProjectRoot, ".cline", "settings.json"))
		})

		it("should return only global path when no project root", () => {
			const globalLoader = new HookConfigurationLoader()
			const paths = globalLoader.getConfigPaths()
			expect(paths.global).to.equal(path.join(os.homedir(), ".cline", "settings.json"))
			expect(paths.project).to.be.undefined
		})
	})
})
