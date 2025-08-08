import { describe, it, before, after, beforeEach } from "mocha"
import { expect } from "chai"
import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import * as os from "os"
import { saveOpenDocumentIfDirty } from "@/hosts/vscode/hostbridge/workspace/saveOpenDocumentIfDirty"
import { SaveOpenDocumentIfDirtyRequest } from "@/shared/proto/index.host"

describe("saveOpenDocumentIfDirty Integration Test", () => {
	let testWorkspaceRoot: string
	let testFilePath: string
	let testFileUri: vscode.Uri

	before(async () => {
		// Use a temporary directory for tests
		testWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cline-test-"))

		// Create a test file path
		testFilePath = path.join(testWorkspaceRoot, "test-save-document.txt")
		testFileUri = vscode.Uri.file(testFilePath)
	})

	after(async () => {
		// Clean up: close all editors and delete test directory
		await vscode.commands.executeCommand("workbench.action.closeAllEditors")
		try {
			await fs.rm(testWorkspaceRoot, { recursive: true, force: true })
		} catch (error) {
			// Directory might not exist, ignore
		}
	})

	beforeEach(async () => {
		// Close all editors before each test
		await vscode.commands.executeCommand("workbench.action.closeAllEditors")
	})

	it("should save a dirty document and return wasSaved: true", async () => {
		// Create a test file with initial content
		await fs.writeFile(testFilePath, "Initial content")

		// Open the document in VSCode
		const document = await vscode.workspace.openTextDocument(testFileUri)
		const editor = await vscode.window.showTextDocument(document)

		// Make the document dirty by editing it
		await editor.edit((editBuilder) => {
			editBuilder.insert(new vscode.Position(0, 0), "Modified ")
		})

		// Verify the document is dirty
		expect(document.isDirty).to.be.true

		// Call saveOpenDocumentIfDirty
		const request = SaveOpenDocumentIfDirtyRequest.create({
			filePath: testFilePath,
		})
		const response = await saveOpenDocumentIfDirty(request)

		// Verify the response
		expect(response.wasSaved).to.be.true

		// Verify the document is no longer dirty
		expect(document.isDirty).to.be.false

		// Verify the file content was saved
		const savedContent = await fs.readFile(testFilePath, "utf-8")
		expect(savedContent).to.equal("Modified Initial content")
	})

	it("should not save a clean document and return empty response", async () => {
		// Create a test file
		await fs.writeFile(testFilePath, "Clean content")

		// Open the document in VSCode
		const document = await vscode.workspace.openTextDocument(testFileUri)
		await vscode.window.showTextDocument(document)

		// Verify the document is not dirty
		expect(document.isDirty).to.be.false

		// Call saveOpenDocumentIfDirty
		const request = SaveOpenDocumentIfDirtyRequest.create({
			filePath: testFilePath,
		})
		const response = await saveOpenDocumentIfDirty(request)

		// Verify the response
		expect(response.wasSaved).to.be.undefined

		// Verify the document is still not dirty
		expect(document.isDirty).to.be.false
	})

	it("should return empty response when document is not open", async () => {
		// Ensure no documents are open
		await vscode.commands.executeCommand("workbench.action.closeAllEditors")

		// Call saveOpenDocumentIfDirty with a non-existent file
		const request = SaveOpenDocumentIfDirtyRequest.create({
			filePath: path.join(testWorkspaceRoot, "non-existent-file.txt"),
		})
		const response = await saveOpenDocumentIfDirty(request)

		// Verify the response
		expect(response.wasSaved).to.be.undefined
	})

	it("should handle multiple open documents and save only the specified one", async () => {
		// Create multiple test files
		const testFile1 = path.join(testWorkspaceRoot, "test-file-1.txt")
		const testFile2 = path.join(testWorkspaceRoot, "test-file-2.txt")
		const testFile3 = path.join(testWorkspaceRoot, "test-file-3.txt")

		await fs.writeFile(testFile1, "File 1 content")
		await fs.writeFile(testFile2, "File 2 content")
		await fs.writeFile(testFile3, "File 3 content")

		try {
			// Open all documents
			const doc1 = await vscode.workspace.openTextDocument(vscode.Uri.file(testFile1))
			const doc2 = await vscode.workspace.openTextDocument(vscode.Uri.file(testFile2))
			const doc3 = await vscode.workspace.openTextDocument(vscode.Uri.file(testFile3))

			// Edit all documents to make them dirty
			const editor1 = await vscode.window.showTextDocument(doc1)
			await editor1.edit((editBuilder) => {
				editBuilder.insert(new vscode.Position(0, 0), "Modified ")
			})

			const editor2 = await vscode.window.showTextDocument(doc2)
			await editor2.edit((editBuilder) => {
				editBuilder.insert(new vscode.Position(0, 0), "Modified ")
			})

			const editor3 = await vscode.window.showTextDocument(doc3)
			await editor3.edit((editBuilder) => {
				editBuilder.insert(new vscode.Position(0, 0), "Modified ")
			})

			// Verify all documents are dirty
			expect(doc1.isDirty).to.be.true
			expect(doc2.isDirty).to.be.true
			expect(doc3.isDirty).to.be.true

			// Save only the second document
			const request = SaveOpenDocumentIfDirtyRequest.create({
				filePath: testFile2,
			})
			const response = await saveOpenDocumentIfDirty(request)

			// Verify the response
			expect(response.wasSaved).to.be.true

			// Verify only doc2 was saved
			expect(doc1.isDirty).to.be.true
			expect(doc2.isDirty).to.be.false
			expect(doc3.isDirty).to.be.true

			// Verify the file content
			const savedContent = await fs.readFile(testFile2, "utf-8")
			expect(savedContent).to.equal("Modified File 2 content")
		} finally {
			// Clean up
			await fs.unlink(testFile1).catch(() => {})
			await fs.unlink(testFile2).catch(() => {})
			await fs.unlink(testFile3).catch(() => {})
		}
	})

	it("should handle empty file path gracefully", async () => {
		const request = SaveOpenDocumentIfDirtyRequest.create({
			filePath: "",
		})
		const response = await saveOpenDocumentIfDirty(request)

		expect(response.wasSaved).to.be.undefined
	})

	it("should handle undefined file path gracefully", async () => {
		const request = SaveOpenDocumentIfDirtyRequest.create({})
		const response = await saveOpenDocumentIfDirty(request)

		expect(response.wasSaved).to.be.undefined
	})
})
