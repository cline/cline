/**
 * Tests for task list command
 */

import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import sinon from "sinon"
import { createTaskListCommand } from "../../../../src/commands/task/list.js"
import type { OutputFormatter } from "../../../../src/core/output/types.js"
import type { CliConfig } from "../../../../src/types/config.js"
import type { Logger } from "../../../../src/types/logger.js"

describe("task list command", () => {
	let tempDir: string
	let config: CliConfig
	let logger: Logger
	let formatter: OutputFormatter
	let exitStub: sinon.SinonStub

	beforeEach(() => {
		// Create temp directory
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-test-"))

		// Create mock config
		config = {
			verbose: false,
			configDir: tempDir,
			outputFormat: "plain",
		}

		// Create mock logger
		logger = {
			debug: sinon.stub(),
			info: sinon.stub(),
			warn: sinon.stub(),
			error: sinon.stub(),
		}

		// Create mock formatter
		formatter = {
			message: sinon.stub(),
			success: sinon.stub(),
			error: sinon.stub(),
			info: sinon.stub(),
			warn: sinon.stub(),
			table: sinon.stub(),
			list: sinon.stub(),
			tasks: sinon.stub(),
			keyValue: sinon.stub(),
			raw: sinon.stub(),
		}

		// Stub process.exit
		exitStub = sinon.stub(process, "exit")
	})

	afterEach(() => {
		// Restore stubs
		sinon.restore()
		// Clean up temp directory
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("should create command with correct name and aliases", () => {
		const cmd = createTaskListCommand(config, logger, formatter)

		expect(cmd.name()).to.equal("list")
		expect(cmd.aliases()).to.include("l")
		expect(cmd.aliases()).to.include("ls")
	})

	it("should show message when no tasks exist", async () => {
		const cmd = createTaskListCommand(config, logger, formatter)

		await cmd.parseAsync(["node", "test"])

		expect((formatter.info as sinon.SinonStub).calledWith("No tasks found")).to.be.true
	})

	it("should error on invalid status filter", async () => {
		const cmd = createTaskListCommand(config, logger, formatter)

		await cmd.parseAsync(["node", "test", "--status", "invalid"])

		expect((formatter.error as sinon.SinonStub).calledOnce).to.be.true
		expect((formatter.error as sinon.SinonStub).firstCall.args[0]).to.include("Invalid status")
		expect(exitStub.calledWith(1)).to.be.true
	})
})
