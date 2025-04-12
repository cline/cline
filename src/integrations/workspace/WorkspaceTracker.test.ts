import path from "path"
import os from "os"
import fs from "fs/promises"

import { after, describe, it, beforeEach, before } from "mocha"
import { expect } from "chai"
import sinon from "sinon"

import * as vscode from "vscode"
import WorkspaceTracker from "./WorkspaceTracker"
import { shouldTrackFile } from "../../services/glob/list-files"

const timeout = () => {
	return new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 1000))
}

describe("WorkspaceTracker", () => {
	describe("file system watcher", () => {
		const tmpDir = path.join(os.tmpdir(), "cline-test-" + Math.random().toString(36).slice(2))

		let filePaths: string[] = []
		let workspaceTracker: WorkspaceTracker
		let sandbox: sinon.SinonSandbox

		// Wait for the fileSystemWatcher event trigger
		let fileSystemWatcherWaiter: Array<() => void> = []

		const waitForFileChange = async (operation?: () => Promise<unknown> | Thenable<void>) => {
			const promise = new Promise<void>((res) => {
				fileSystemWatcherWaiter.push(res)
			})

			if (operation) {
				await operation()
			}

			return Promise.race([promise, timeout()])
		}

		before(async () => {
			await fs.mkdir(tmpDir, { recursive: true })
			// If we don't wait for the directory to be created,
			// the fileSystemWatcher might send the event while we are waiting for another file operation
			// which will resolve the promise before we intend and fail the tests.
			await new Promise((res) => setTimeout(res, 500))
		})

		beforeEach(() => {
			sandbox = sinon.createSandbox()

			sandbox.stub(vscode.workspace, "workspaceFolders").value([
				{
					name: "Test Workspace",
					uri: vscode.Uri.from({
						scheme: "file",
						path: tmpDir,
					}),
				},
			])

			filePaths = []
			workspaceTracker = new WorkspaceTracker(async (message) => {
				filePaths = message.filePaths || []

				if (fileSystemWatcherWaiter.length > 0) {
					const resolve = fileSystemWatcherWaiter.shift()
					resolve?.()
				}
			})
		})

		afterEach(() => {
			workspaceTracker.dispose()
			sandbox.restore()
		})

		// Clean up after tests
		after(async () => {
			try {
				await fs.rm(tmpDir, { recursive: true, force: true })
			} catch {
				// Ignore cleanup errors
			}
		})

		it("should keep the filePaths updated", async () => {
			const testFile = path.join(tmpDir, "test.txt")
			const fileThroughVSActions = path.join(tmpDir, "test2.txt")

			await waitForFileChange(() => fs.writeFile(testFile, "test"))
			await waitForFileChange(() =>
				vscode.workspace.fs.writeFile(vscode.Uri.file(fileThroughVSActions), new TextEncoder().encode("test")),
			)

			expect(filePaths).to.contain("test.txt")
			expect(filePaths).to.contain("test2.txt")

			await waitForFileChange(() => fs.unlink(testFile))

			expect(filePaths).to.not.contain("test.txt")
			expect(filePaths).to.contain("test2.txt")
		})

		describe("when it has subdirectories", () => {
			it("should remove all files when deleting a directory", async () => {
				const subDir = path.join(tmpDir, "test")
				const testFile = path.join(subDir, "test.txt")
				const similarlyNamedFile = path.join(tmpDir, "test.js")

				await waitForFileChange(() => fs.mkdir(subDir))
				await waitForFileChange(() => fs.writeFile(testFile, "test"))
				await waitForFileChange(() => fs.writeFile(similarlyNamedFile, "test"))

				expect(filePaths).to.contain("test/test.txt")
				expect(filePaths).to.contain("test/")
				expect(filePaths).to.contain("test.js")

				await waitForFileChange(() => fs.rm(subDir, { recursive: true, force: true }))

				expect(filePaths).to.not.contain("test/test.txt")
				expect(filePaths).to.not.contain("test/")
				expect(filePaths).to.contain("test.js")
			})
		})

		describe("when renaming", () => {
			const renameOperation = async (oldPath: string, newPath: string) => {
				// Renames trigger a deletion and a creation event. This will ensure we wait for both.
				const createOperation = waitForFileChange()
				const deleteOperation = waitForFileChange(() => fs.rename(oldPath, newPath))
				return Promise.all([createOperation, deleteOperation])
			}

			it("should update file paths", async () => {
				const testFile = path.join(tmpDir, "test.txt")
				const renamedFile = path.join(tmpDir, "renamed.txt")

				await waitForFileChange(() => fs.writeFile(testFile, "test"))
				await renameOperation(testFile, renamedFile)

				expect(filePaths).to.contain("renamed.txt")
				expect(filePaths).to.not.contain("test.txt")
			})

			it("should update all files within a directory when renaming it", async () => {
				const subDir = path.join(tmpDir, "test_rename")
				const testFile = path.join(subDir, "test.txt")
				const renamedDir = path.join(tmpDir, "renamed")

				await waitForFileChange(() => fs.mkdir(subDir))
				await waitForFileChange(() => fs.writeFile(testFile, "test"))
				await renameOperation(subDir, renamedDir)

				expect(filePaths).to.contain("renamed/")
				expect(filePaths).to.contain("renamed/test.txt")
				expect(filePaths).to.not.contain("test_rename/test.txt")
			})
		})
	})

	describe("should ignore files", () => {
		const directories = ["node_modules", "__pycache__", "env"]
		it("ignores directories in the root of the workspace", () => {
			directories.forEach((dir) => {
				expect(shouldTrackFile(dir)).to.be.false
			})
		})

		it("ignores files within those directories", () => {
			directories.forEach((dir) => {
				expect(shouldTrackFile(`${dir}/test.txt`)).to.be.false
			})
		})

		it("ignores nested ignored directories", () => {
			expect(shouldTrackFile("test")).to.be.true

			directories.forEach((dir) => {
				expect(shouldTrackFile("test/" + dir)).to.be.false
			})
		})

		it("ignores files in hidden directories", () => {
			const directories = [".git", ".vscode", ".env"]

			directories.forEach((dir) => {
				expect(shouldTrackFile(`${dir}/test.txt`)).to.be.false
			})
		})
	})
})
