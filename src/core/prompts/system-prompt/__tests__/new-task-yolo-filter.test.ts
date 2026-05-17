import { expect } from "chai"
import { before, describe, it } from "mocha"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { ClineToolSet } from "../registry/ClineToolSet"
import { PromptRegistry } from "../registry/PromptRegistry"
import { new_task_variants } from "../tools/new_task"
import type { SystemPromptContext } from "../types"
import { mockProviderInfo } from "./integration.test"

const baseContext: SystemPromptContext = {
	cwd: "/test/project",
	ide: "TestIde",
	supportsBrowserUse: true,
	providerInfo: mockProviderInfo,
	isTesting: true,
}

describe("new_task tool contextRequirements", () => {
	before(() => {
		// Ensure tools are registered via PromptRegistry initialization
		PromptRegistry.getInstance()
	})

	const genericVariant = new_task_variants.find((v) => v.variant === ModelFamily.GENERIC)

	it("should have a contextRequirements function defined", () => {
		expect(genericVariant).to.exist
		expect(genericVariant!.contextRequirements).to.be.a("function")
	})

	it("should be enabled when yoloModeToggled is false", () => {
		const context: SystemPromptContext = { ...baseContext, yoloModeToggled: false }
		expect(genericVariant!.contextRequirements!(context)).to.be.true
	})

	it("should be enabled when yoloModeToggled is undefined", () => {
		const context: SystemPromptContext = { ...baseContext, yoloModeToggled: undefined }
		expect(genericVariant!.contextRequirements!(context)).to.be.true
	})

	it("should be disabled when yoloModeToggled is true", () => {
		const context: SystemPromptContext = { ...baseContext, yoloModeToggled: true }
		expect(genericVariant!.contextRequirements!(context)).to.be.false
	})

	it("should follow the same pattern as ask_followup_question", () => {
		const newTaskTool = ClineToolSet.getToolByNameWithFallback(ClineDefaultTool.NEW_TASK, ModelFamily.GENERIC)
		const askTool = ClineToolSet.getToolByNameWithFallback(ClineDefaultTool.ASK, ModelFamily.GENERIC)

		expect(newTaskTool).to.exist
		expect(askTool).to.exist
		expect(newTaskTool!.config.contextRequirements).to.be.a("function")
		expect(askTool!.config.contextRequirements).to.be.a("function")

		const yoloContext: SystemPromptContext = { ...baseContext, yoloModeToggled: true }
		const normalContext: SystemPromptContext = { ...baseContext, yoloModeToggled: false }

		expect(newTaskTool!.config.contextRequirements!(yoloContext)).to.be.false
		expect(askTool!.config.contextRequirements!(yoloContext)).to.be.false

		expect(newTaskTool!.config.contextRequirements!(normalContext)).to.be.true
		expect(askTool!.config.contextRequirements!(normalContext)).to.be.true
	})
})
