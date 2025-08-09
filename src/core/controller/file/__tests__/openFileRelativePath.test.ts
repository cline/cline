import { describe, it, beforeEach, afterEach } from "mocha"
import { expect } from "chai"
import * as sinon from "sinon"
import { openFileRelativePath } from "../openFileRelativePath"
import { Controller } from "@core/controller"
import { StringRequest, Empty } from "@shared/proto/cline/common"
import * as openFileIntegration from "@integrations/misc/open-file"
import * as pathUtils from "@utils/path"
import * as path from "path"

describe("openFileRelativePath", () => {
	let sandbox: sinon.SinonSandbox
	let mockController: Controller
	let openFileIntegrationStub: sinon.SinonStub
	let getWorkspacePathStub: sinon.SinonStub
	let consoleErrorStub: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Create a mock controller
		mockController = {} as any

		// Stub the openFileIntegration function
		openFileIntegrationStub = sandbox.stub(openFileIntegration, "openFile")

		// Stub getWorkspacePath utility
		getWorkspacePathStub = sandbox.stub(pathUtils, "getWorkspacePath")

		// Stub console.error to prevent test output pollution
		consoleErrorStub = sandbox.stub(console, "error")
	})

	afterEach(() => {
		sandbox.restore()
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
