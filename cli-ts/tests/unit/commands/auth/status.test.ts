/**
 * Tests for auth status command
 */

import { expect } from "chai"
import sinon from "sinon"
import { createAuthCommand } from "../../../../src/commands/auth/index.js"
import type { OutputFormatter } from "../../../../src/core/output/types.js"
import type { CliConfig } from "../../../../src/types/config.js"
import type { Logger } from "../../../../src/types/logger.js"

describe("auth status command", () => {
	let config: CliConfig
	let logger: Logger
	let formatter: OutputFormatter

	beforeEach(() => {
		// Create mock config
		config = {
			verbose: false,
			configDir: "/tmp/cline-test",
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
	})

	afterEach(() => {
		sinon.restore()
	})

	it("should create command with --status option", () => {
		const cmd = createAuthCommand(config, logger, formatter)

		// Get the options from the command
		const options = cmd.options
		const statusOption = options.find((opt) => opt.short === "-s" || opt.long === "--status")

		expect(statusOption).to.exist
		expect(statusOption?.long).to.equal("--status")
		expect(statusOption?.short).to.equal("-s")
	})

	it("should have correct command name and alias", () => {
		const cmd = createAuthCommand(config, logger, formatter)

		expect(cmd.name()).to.equal("auth")
		expect(cmd.aliases()).to.include("a")
	})

	it("should have description for status option", () => {
		const cmd = createAuthCommand(config, logger, formatter)

		const options = cmd.options
		const statusOption = options.find((opt) => opt.long === "--status")

		expect(statusOption?.description).to.include("status")
	})
})
