import type { AvailableRuntimeCommand } from "@cline/core"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as sinon from "sinon"
import { Controller } from "../core/controller"
import { getAvailableSlashCommands } from "../core/controller/slash/getAvailableSlashCommands"
import { EmptyRequest } from "../shared/proto/cline/common"
import { BASE_SLASH_COMMANDS } from "../shared/slashCommands"

function skill(name: string, description?: string): AvailableRuntimeCommand {
	return { id: `skill:${name}`, name, instructions: `Skill ${name}`, description, kind: "skill" }
}

function workflow(name: string, description?: string): AvailableRuntimeCommand {
	return { id: `workflow:${name}`, name, instructions: `Workflow ${name}`, description, kind: "workflow" }
}

/**
 * Unit tests for the getAvailableSlashCommands RPC endpoint: built-ins plus the
 * runtime skills/workflows the SdkController already filtered by toggles.
 */
describe("getAvailableSlashCommands", () => {
	let listRuntimeSlashCommands: sinon.SinonStub
	let mockController: Partial<Controller>

	beforeEach(() => {
		listRuntimeSlashCommands = sinon.stub().resolves([])
		mockController = { listRuntimeSlashCommands } as Partial<Controller>
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("Base Slash Commands", () => {
		it("should return all base slash commands with section 'default' and kind 'builtin'", async () => {
			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			response.commands.length.should.equal(BASE_SLASH_COMMANDS.length)
			for (const baseCmd of BASE_SLASH_COMMANDS) {
				const found = response.commands.find((cmd) => cmd.name === baseCmd.name)
				found!.should.not.be.undefined()
				found!.description.should.equal(baseCmd.description)
				found!.section.should.equal("default")
				found!.kind.should.equal("builtin")
				found!.cliCompatible.should.equal(baseCmd.cliCompatible ?? false)
			}
		})

		it("should not include the deprecated subagent slash command", async () => {
			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())
			const deprecatedCommand = response.commands.find((cmd) => cmd.name === "subagent")
			;(deprecatedCommand === undefined).should.be.true()
		})
	})

	describe("Runtime commands", () => {
		it("should list skills with section 'skill' and their description", async () => {
			listRuntimeSlashCommands.resolves([skill("aws-deploy", "Deploy to AWS.")])

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const command = response.commands.find((cmd) => cmd.name === "aws-deploy")
			command!.should.not.be.undefined()
			command!.section.should.equal("skill")
			command!.kind.should.equal("skill")
			command!.description.should.equal("Deploy to AWS.")
			command!.cliCompatible.should.be.true()
		})

		it("should list workflows with section 'custom'", async () => {
			listRuntimeSlashCommands.resolves([workflow("release")])

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const command = response.commands.find((cmd) => cmd.name === "release")
			command!.should.not.be.undefined()
			command!.section.should.equal("custom")
			command!.kind.should.equal("workflow")
			command!.description.should.equal("")
		})

		it("should order built-ins, then skills, then workflows regardless of runtime order", async () => {
			listRuntimeSlashCommands.resolves([
				workflow("a-workflow"),
				skill("z-skill"),
				workflow("b-workflow"),
				skill("y-skill"),
			])

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const names = response.commands.map((cmd) => cmd.name)
			names.slice(0, BASE_SLASH_COMMANDS.length).should.deepEqual(BASE_SLASH_COMMANDS.map((cmd) => cmd.name))
			names.slice(BASE_SLASH_COMMANDS.length).should.deepEqual(["z-skill", "y-skill", "a-workflow", "b-workflow"])
		})

		it("should use the runtime token verbatim, since that is what the send path resolves", async () => {
			listRuntimeSlashCommands.resolves([skill("ship-it"), workflow("my-workflow")])

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const names = response.commands.map((cmd) => cmd.name)
			names.should.containEql("ship-it")
			names.should.containEql("my-workflow")
			names.should.not.containEql("my-workflow.md")
		})

		it("should return only built-ins when the runtime lists nothing", async () => {
			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())
			response.commands.length.should.equal(BASE_SLASH_COMMANDS.length)
			listRuntimeSlashCommands.calledOnce.should.be.true()
		})
	})
})
