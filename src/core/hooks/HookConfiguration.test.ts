/**
 * Tests for HookConfigurationLoader
 */

import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as sinon from "sinon"
import { HookConfigurationLoader } from "./HookConfiguration"

describe("HookConfigurationLoader", () => {
	let loader: HookConfigurationLoader
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		// Mock os.homedir
		sandbox.stub(os, "homedir").returns("/home/user")
		loader = new HookConfigurationLoader()
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("getConfiguration", () => {
		it("should load valid configuration from file", async () => {
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

			sandbox.stub(fs, "stat").resolves({
				mtimeMs: 1234567890,
			} as any)

			sandbox.stub(fs, "readFile").resolves(JSON.stringify(mockConfig))

			const config = await loader.getConfiguration()

			expect(config).to.deep.equal(mockConfig)
		})

		it("should return default config if file doesn't exist", async () => {
			const error = new Error("ENOENT") as NodeJS.ErrnoException
			error.code = "ENOENT"
			sandbox.stub(fs, "stat").rejects(error)

			const config = await loader.getConfiguration()

			expect(config.hooks).to.deep.equal({})
			expect(config.settings?.defaultTimeout).to.equal(60)
		})

		it("should return default config on parse error", async () => {
			sandbox.stub(fs, "stat").resolves({
				mtimeMs: 1234567890,
			} as any)

			sandbox.stub(fs, "readFile").resolves("invalid json {")

			const config = await loader.getConfiguration()

			expect(config.hooks).to.deep.equal({})
		})
	})

	describe("saveConfiguration", () => {
		it("should save configuration to file", async () => {
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
			sandbox.stub(fs, "stat").resolves({
				mtimeMs: 1234567890,
			} as any)

			await loader.saveConfiguration(config)

			expect(mkdirStub.called).to.be.true
			expect(writeFileStub.called).to.be.true
		})
	})

	describe("hasHooks", () => {
		it("should return true when hooks are configured", async () => {
			sandbox.stub(fs, "stat").resolves({
				mtimeMs: 1234567890,
			} as any)

			sandbox.stub(fs, "readFile").resolves(
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
			sandbox.stub(fs, "stat").resolves({
				mtimeMs: 1234567890,
			} as any)

			sandbox.stub(fs, "readFile").resolves(
				JSON.stringify({
					hooks: {},
				}),
			)

			const result = await loader.hasHooks()
			expect(result).to.be.false
		})
	})

	describe("getConfigPath", () => {
		it("should return default config path", () => {
			expect(loader.getConfigPath()).to.equal("/home/user/.cline/hooks.json")
		})

		it("should return custom config path", () => {
			const customLoader = new HookConfigurationLoader("/custom/path/hooks.json")
			expect(customLoader.getConfigPath()).to.equal("/custom/path/hooks.json")
		})
	})
})
