import { Controller } from "@core/controller"
import { BooleanResponse, StringRequest } from "@shared/proto/cline/common"
import * as actualPathUtils from "@utils/path"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import * as sinon from "sinon"

// bun loads real ESM, so sinon cannot stub the `@utils/path` namespace export
// ("ES Modules cannot be stubbed"). Inject a module-level sinon stub via
// mock.module so the full sinon stub API keeps working.
const getWorkspacePathStub: sinon.SinonStub = sinon.stub()
const pathUtilsMock = () => ({ ...actualPathUtils, getWorkspacePath: getWorkspacePathStub })
mock.module("@utils/path", pathUtilsMock)
mock.module("@/utils/path", pathUtilsMock)

import { ifFileExistsRelativePath } from "../ifFileExistsRelativePath"

describe("ifFileExistsRelativePath", () => {
	let mockController: Controller

	beforeEach(() => {
		// Create a mock controller
		mockController = {} as any

		// Reset the module-level getWorkspacePath stub
		getWorkspacePathStub.reset()
	})

	afterEach(() => {
		getWorkspacePathStub.reset()
	})

	it("should return BooleanResponse with boolean value", async () => {
		getWorkspacePathStub.resolves("/workspace")

		const request = StringRequest.create({
			value: "src/test.ts",
		})

		const result = await ifFileExistsRelativePath(mockController, request)

		// The result should be a BooleanResponse object
		expect(result).to.have.property("value")
		expect(typeof result.value).to.equal("boolean")
	})

	it("should return false when no workspace path is available", async () => {
		const noWorkspaceScenarios = [null, undefined]

		for (const workspaceValue of noWorkspaceScenarios) {
			getWorkspacePathStub.resolves(workspaceValue)

			const request = StringRequest.create({
				value: "src/test.ts",
			})

			const result = await ifFileExistsRelativePath(mockController, request)

			expect(result).to.deep.equal(BooleanResponse.create({ value: false }))
		}
	})

	it("should return false when path is invalid", async () => {
		getWorkspacePathStub.resolves("/workspace")

		const invalidPaths = ["", undefined]

		for (const invalidPath of invalidPaths) {
			const request = StringRequest.create({
				value: invalidPath,
			})

			const result = await ifFileExistsRelativePath(mockController, request)

			expect(result).to.deep.equal(BooleanResponse.create({ value: false }))
		}
	})

	it("should handle valid relative paths correctly", async () => {
		getWorkspacePathStub.resolves("/workspace")

		// Test with valid workspace-relative paths only
		const validPaths = ["src/file.ts", "./src/file.ts", "package.json", ".gitignore", "src/components/ui/Button/Button.tsx"]

		for (const testPath of validPaths) {
			const request = StringRequest.create({
				value: testPath,
			})

			const result = await ifFileExistsRelativePath(mockController, request)

			// Each should return a BooleanResponse
			expect(result).to.have.property("value")
			expect(typeof result.value).to.equal("boolean")
		}

		// Verify that getWorkspacePath was called for each path
		expect(getWorkspacePathStub.callCount).to.equal(validPaths.length)
	})
})
