import { expect } from "chai"
import sinon from "sinon"
import type { ToolUse } from "@core/assistant-message"
import type { TaskConfig } from "@core/task/tools/types/TaskConfig"
import { ListFilesToolHandler } from "@core/task/tools/handlers/ListFilesToolHandler"
import { ToolValidator } from "@core/task/tools/ToolValidator"
import type { ToolResponse } from "@core/task"

function createMockConfig(overrides: Partial<TaskConfig> = {}): TaskConfig {
	return {
		ulid: "test-ulid",
		cwd: ".",
		session: {
			id: "session-id",
		},
		taskState: {
			consecutiveMistakeCount: 0,
			consecutiveAutoApprovedRequestsCount: 0,
		},
		callbacks: {
			sayAndCreateMissingParamError: sinon.stub().resolves({} as ToolResponse),
			say: sinon.stub().resolves(),
			removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
			shouldAutoApproveToolWithPath: sinon.stub().resolves(false),
			showManualApprovalNotification: sinon.stub().resolves(),
		},
		services: {
			clineIgnoreController: {
				excludeList: [],
				shouldIgnore: sinon.stub().returns(false),
			},
		},
		api: {
			getModel: () => ({ id: "test-model" }),
		},
		flow: {
			registerFollowupAction: sinon.stub(),
		},
		...overrides,
	} as unknown as TaskConfig
}

describe("ListFilesToolHandler", () => {
	let validator: ToolValidator

	beforeEach(() => {
		validator = {
			assertRequiredParams: sinon.stub().returns({ ok: true }),
		} as unknown as ToolValidator
	})

	it("rejects directory paths containing plan template artifacts", async () => {
		const handler = new ListFilesToolHandler(validator)
		const config = createMockConfig()

		const block = {
			name: handler.name,
			params: {
				path: "<task_progress>" as const,
			},
		} as unknown as ToolUse

		const response = await handler.execute(config, block)

		expect(config.taskState.consecutiveMistakeCount).to.equal(1)
		expect(response.status).to.equal("error")
		expect(response.result).to.match(/Directory path contains template/)
	})
})
