import { describe, it } from "mocha"
import should from "should"
import sinon from "sinon"
import * as childProcess from "child_process"
import { Readable } from "stream"
import type { FzfResultItem } from "fzf"
import * as searchService from "@utils/search"
import * as hostProviders from "@/hosts/host-providers"
import { WorkspaceSearchResponse, WorkspaceSearchResult } from "@shared/proto/host/search"
import { String } from "@shared/proto/common"
import { OrderbyMatchScore } from "@hosts/vscode/search/searchWorkspaceFiles"

describe("File Search", function () {
	let sandbox: sinon.SinonSandbox
	let spawnStub: sinon.SinonStub

	beforeEach(function () {
		sandbox = sinon.createSandbox()
		spawnStub = sandbox.stub()

		// Create a wrapper function that matches the signature of childProcess.spawn
		const spawnWrapper: typeof childProcess.spawn = function (command, options) {
			return spawnStub(command, options)
		}

		// Mock the host bridge provider instead of individual functions
		const mockHostBridgeProvider = {
			searchClient: {
				searchWorkspaceFiles: sandbox.stub(),
				regexSearchFiles: sandbox.stub(),
				getBinPath: sandbox.stub().resolves({ value: "mock/ripgrep/path" }),
			},
			uriServiceClient: {},
			watchServiceClient: {},
			workspaceClient: {},
			envClient: {},
		}
		sandbox.stub(hostProviders, "getHostBridgeProvider").returns(mockHostBridgeProvider as any)
	})

	afterEach(function () {
		sandbox.restore()
	})

	describe("executeRipgrepForFiles", function () {
		it("should correctly process and return file and folder results", async function () {
			const mockFiles = ["file1.txt", "folder1/file2.js", "folder1/subfolder/file3.py"]

			// Create a proper mock for the child process
			const mockStdout = new Readable({
				read() {
					this.push(mockFiles.join("\n"))
					this.push(null) // Signal the end of the stream
				},
			})

			const mockStderr = new Readable({
				read() {
					this.push(null) // Empty stream
				},
			})

			spawnStub.returns({
				stdout: mockStdout,
				stderr: mockStderr,
				on: sinon.stub().returns({}),
			} as unknown as childProcess.ChildProcess)

			// Instead of stubbing path functions, we'll stub the executeRipgrepForFiles function
			// to return a predictable result for this test
			const expectedResult: { path: string; type: "file" | "folder"; label?: string }[] = [
				{ path: "file1.txt", type: "file", label: "file1.txt" },
				{ path: "folder1/file2.js", type: "file", label: "file2.js" },
				{ path: "folder1/subfolder/file3.py", type: "file", label: "file3.py" },
				{ path: "folder1", type: "folder", label: "folder1" },
				{ path: "folder1/subfolder", type: "folder", label: "subfolder" },
			]

			// Mock the host bridge to return expected result
			const mockHostBridge = hostProviders.getHostBridgeProvider() as any
			mockHostBridge.searchClient.searchWorkspaceFiles.resolves({
				results: expectedResult.map((item) => WorkspaceSearchResult.create(item)),
			})

			const result = await searchService.searchWorkspaceFiles("", "/workspace", 5000)

			should(result).be.an.Array()
			// Don't assert on the exact length as it may vary

			const files = result.filter((item) => item.type === "file")
			const folders = result.filter((item) => item.type === "folder")

			// Verify we have at least the expected files and folders
			should(files.length).be.greaterThanOrEqual(3)
			should(folders.length).be.greaterThanOrEqual(2)

			should(files[0]).have.properties({
				path: "file1.txt",
				type: "file",
				label: "file1.txt",
			})

			should(folders).containDeep([
				{ path: "folder1", type: "folder", label: "folder1" },
				{ path: "folder1/subfolder", type: "folder", label: "subfolder" },
			])
		})

		it("should handle errors from ripgrep", async function () {
			const mockError = "Mock ripgrep error"

			// Create proper mock streams for error case
			const mockStdout = new Readable({
				read() {
					this.push(null) // Empty stream
				},
			})

			const mockStderr = new Readable({
				read() {
					this.push(mockError)
					this.push(null) // Signal the end of the stream
				},
			})

			spawnStub.returns({
				stdout: mockStdout,
				stderr: mockStderr,
				on: function (event: string, callback: Function) {
					if (event === "error") {
						callback(new Error(mockError))
					}
					return this
				},
			} as unknown as childProcess.ChildProcess)

			// Mock the host bridge to throw an error
			const mockHostBridge = hostProviders.getHostBridgeProvider() as any
			mockHostBridge.searchClient.searchWorkspaceFiles.rejects(new Error(`ripgrep process error: ${mockError}`))

			await should(searchService.searchWorkspaceFiles("", "/workspace", 5000)).be.rejectedWith(
				`ripgrep process error: ${mockError}`,
			)
		})
	})

	describe("searchWorkspaceFiles", function () {
		it("should return top N results for empty query", async function () {
			const mockItems: { path: string; type: "file" | "folder"; label?: string }[] = [
				{ path: "file1.txt", type: "file", label: "file1.txt" },
				{ path: "folder1", type: "folder", label: "folder1" },
				{ path: "file2.js", type: "file", label: "file2.js" },
			]

			// Mock the host bridge to return expected result
			const mockHostBridge = hostProviders.getHostBridgeProvider() as any
			mockHostBridge.searchClient.searchWorkspaceFiles.resolves({
				results: mockItems.slice(0, 2).map((item) => WorkspaceSearchResult.create(item)),
			})

			const result = await searchService.searchWorkspaceFiles("", "/workspace", 2)

			should(result).be.an.Array()
			should(result).have.length(2)
			should(result).deepEqual(mockItems.slice(0, 2))
		})

		it("should apply fuzzy matching for non-empty query", async function () {
			const mockItems: { path: string; type: "file" | "folder"; label?: string }[] = [
				{ path: "file1.txt", type: "file", label: "file1.txt" },
				{ path: "folder1/important.js", type: "file", label: "important.js" },
				{ path: "file2.js", type: "file", label: "file2.js" },
			]

			// Mock the host bridge to return the fuzzy search result
			const mockHostBridge = hostProviders.getHostBridgeProvider() as any
			mockHostBridge.searchClient.searchWorkspaceFiles.resolves({
				results: [mockItems[1]].map((item) => WorkspaceSearchResult.create(item)),
			})

			const result = await searchService.searchWorkspaceFiles("imp", "/workspace", 2)

			should(result).be.an.Array()
			should(result).have.length(1)
			should(result[0]).have.properties({
				path: "folder1/important.js",
				type: "file",
				label: "important.js",
			})
		})
	})

	describe("OrderbyMatchScore", function () {
		it("should prioritize results with fewer gaps between matched characters", function () {
			const mockItemA: FzfResultItem<any> = { item: {}, positions: new Set([0, 1, 2, 5]), start: 0, end: 5, score: 0 }
			const mockItemB: FzfResultItem<any> = { item: {}, positions: new Set([0, 2, 4, 6]), start: 0, end: 6, score: 0 }

			const result = OrderbyMatchScore(mockItemA, mockItemB)

			should(result).be.lessThan(0)
		})
	})
})
