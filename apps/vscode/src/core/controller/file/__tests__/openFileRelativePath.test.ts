import { Controller } from "@core/controller"
import * as actualOpenFileIntegration from "@integrations/misc/open-file"
import { Empty, StringRequest } from "@shared/proto/cline/common"
import * as actualPathUtils from "@utils/path"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import * as path from "path"
import * as sinon from "sinon"
import { Logger } from "@/shared/services/Logger"

// bun loads real ESM, so sinon cannot stub the `@integrations/misc/open-file`
// and `@utils/path` namespace exports ("ES Modules cannot be stubbed"). Inject
// module-level sinon stubs via mock.module so the full sinon stub API keeps
// working. (`Logger` is a class with static methods and is still sinon-stubbed
// directly below.)
const openFileIntegrationStub: sinon.SinonStub = sinon.stub()
const getWorkspacePathStub: sinon.SinonStub = sinon.stub()
const openFileMock = () => ({ ...actualOpenFileIntegration, openFile: openFileIntegrationStub })
const pathUtilsMock = () => ({ ...actualPathUtils, getWorkspacePath: getWorkspacePathStub })
mock.module("@integrations/misc/open-file", openFileMock)
mock.module("@utils/path", pathUtilsMock)
mock.module("@/utils/path", pathUtilsMock)

import { openFileRelativePath } from "../openFileRelativePath"

describe("openFileRelativePath", () => {
	let sandbox: sinon.SinonSandbox
	let mockController: Controller
	let consoleErrorStub: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Create a mock controller
		mockController = {} as any

		// Reset the module-level sinon stubs (injected via mock.module above)
		openFileIntegrationStub.reset()
		getWorkspacePathStub.reset()

		// Stub console.error to prevent test output pollution
		consoleErrorStub = sandbox.stub(Logger, "error")
	})

	afterEach(() => {
		sandbox.restore()
		openFileIntegrationStub.reset()
		getWorkspacePathStub.reset()
	})

	it("should return Empty response on successful execution", async () => {
		getWorkspacePathStub.resolves("/workspace")

		const request = StringRequest.create({
			value: "src/test.ts",
		})

		const result = await openFileRelativePath(mockController, request)

		expect(result).to.deep.equal(Empty.create())
	})

	it("should call openFileIntegration with absolute path when relative path is provided", async () => {
		const workspacePath = "/workspace"
		const relativePath = "src/components/Test.tsx"
		const expectedAbsolutePath = path.resolve(workspacePath, relativePath)

		getWorkspacePathStub.resolves(workspacePath)

		const request = StringRequest.create({
			value: relativePath,
		})

		await openFileRelativePath(mockController, request)

		expect(openFileIntegrationStub.calledOnceWith(expectedAbsolutePath)).to.be.true
	})

	it("should not call openFileIntegration when path is invalid", async () => {
		getWorkspacePathStub.resolves("/workspace")

		const invalidPaths = ["", undefined]

		for (const invalidPath of invalidPaths) {
			const request = StringRequest.create({
				value: invalidPath,
			})

			await openFileRelativePath(mockController, request)

			expect(openFileIntegrationStub.called).to.be.false
			openFileIntegrationStub.resetHistory()
		}
	})

	it("should return Empty and log error when no workspace path is available", async () => {
		const noWorkspaceScenarios = [null, undefined]

		for (const workspaceValue of noWorkspaceScenarios) {
			getWorkspacePathStub.resolves(workspaceValue)
			consoleErrorStub.resetHistory()

			const request = StringRequest.create({
				value: "src/test.ts",
			})

			const result = await openFileRelativePath(mockController, request)

			expect(result).to.deep.equal(Empty.create())
			expect(consoleErrorStub.called).to.be.true
			expect(openFileIntegrationStub.called).to.be.false
		}
	})

	it("should handle nested directory paths", async () => {
		const workspacePath = "/workspace"
		const relativePath = "src/components/ui/Button/Button.tsx"
		const expectedAbsolutePath = path.resolve(workspacePath, relativePath)

		getWorkspacePathStub.resolves(workspacePath)

		const request = StringRequest.create({
			value: relativePath,
		})

		await openFileRelativePath(mockController, request)

		expect(openFileIntegrationStub.calledOnceWith(expectedAbsolutePath)).to.be.true
	})
})
