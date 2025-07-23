import { describe, it, beforeEach, afterEach } from "mocha"
import "should"
import * as vscode from "vscode"
import * as sinon from "sinon"
import { openFile } from "@/hosts/vscode/hostbridge/window/openFile"
import { OpenFileRequest } from "@/shared/proto/host/window"

describe("openFile hostbridge integration", () => {
	let executeCommandStub: sinon.SinonStub

	beforeEach(() => {
		// Stub vscode.commands.executeCommand to track calls
		executeCommandStub = sinon.stub(vscode.commands, "executeCommand")
		executeCommandStub.resolves() // Mock successful execution
	})

	afterEach(() => {
		// Restore all stubs
		sinon.restore()
	})

	it("should successfully call openFile function directly in Extension Host", async () => {
		// Arrange
		const testFilePath = "/Users/kvyb/Desktop/test-file.txt"
		const request = OpenFileRequest.create({
			filePath: testFilePath,
		})

		// Act - Call the openFile function directly
		const result = await openFile(request)

		// Assert
		should.exist(result)
		result.success.should.be.true()

		// Verify the vscode.open command was called with correct parameters
		sinon.assert.calledOnce(executeCommandStub)
		sinon.assert.calledWith(
			executeCommandStub,
			"vscode.open",
			sinon.match((arg: vscode.Uri) => {
				return arg instanceof vscode.Uri && arg.fsPath === testFilePath
			}),
		)
	})

	it("should handle errors gracefully in Extension Host", async () => {
		// Arrange
		const testFilePath = "/nonexistent/path/file.txt"
		const request = OpenFileRequest.create({
			filePath: testFilePath,
		})

		// Setup stub to reject
		executeCommandStub.rejects(new Error("File not found"))

		// Act
		const result = await openFile(request)

		// Assert
		should.exist(result)
		result.success.should.be.false()

		// Verify the command was still attempted
		sinon.assert.calledOnce(executeCommandStub)
	})

	it("should work with different file types in Extension Host", async () => {
		// Arrange - Test with an image file
		const imageFilePath = "/tmp/screenshot.png"
		const request = OpenFileRequest.create({
			filePath: imageFilePath,
		})

		// Act
		const result = await openFile(request)

		// Assert
		result.success.should.be.true()
		sinon.assert.calledWith(
			executeCommandStub,
			"vscode.open",
			sinon.match((arg: vscode.Uri) => {
				return arg.fsPath === imageFilePath
			}),
		)
	})

	it("should handle special characters in file paths in Extension Host", async () => {
		// Arrange
		const specialFilePath = "/path/with spaces/file (copy).txt"
		const request = OpenFileRequest.create({
			filePath: specialFilePath,
		})

		// Act
		const result = await openFile(request)

		// Assert
		result.success.should.be.true()
		sinon.assert.calledWith(
			executeCommandStub,
			"vscode.open",
			sinon.match((arg: vscode.Uri) => {
				return arg.fsPath === specialFilePath
			}),
		)
	})
})
