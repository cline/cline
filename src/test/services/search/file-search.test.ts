import { describe, it } from "mocha"
import should from "should"
import sinon from "sinon"
import type { FzfResultItem } from "fzf"
import * as searchService from "@utils/search"
import * as hostProviders from "@/hosts/host-providers"
import {
	WorkspaceSearchResponse,
	WorkspaceSearchResult,
	WorkspaceSearchRequest,
	RegexSearchRequest,
} from "@shared/proto/host/search"
import { String } from "@shared/proto/common"
import { OrderbyMatchScore } from "@hosts/vscode/search/searchWorkspaceFiles"

describe("File Search Utils", function () {
	let sandbox: sinon.SinonSandbox
	let mockHostBridgeProvider: any

	beforeEach(function () {
		sandbox = sinon.createSandbox()

		// Mock the host bridge provider with proper proto-based interface
		mockHostBridgeProvider = {
			searchClient: {
				searchWorkspaceFiles: sandbox.stub(),
				regexSearchFiles: sandbox.stub(),
				getBinPath: sandbox.stub(),
			},
			uriServiceClient: {},
			watchServiceClient: {},
			workspaceClient: {},
			envClient: {},
			windowClient: {},
		}
		sandbox.stub(hostProviders, "getHostBridgeProvider").returns(mockHostBridgeProvider)
	})

	afterEach(function () {
		sandbox.restore()
	})

	describe("searchWorkspaceFiles", function () {
		it("should call host bridge with proper proto request and return mapped results", async function () {
			const mockItems: { path: string; type: "file" | "folder"; label?: string }[] = [
				{ path: "file1.txt", type: "file", label: "file1.txt" },
				{ path: "folder1", type: "folder", label: "folder1" },
			]

			// Mock the host bridge to return expected result using proper proto response
			mockHostBridgeProvider.searchClient.searchWorkspaceFiles.resolves(
				WorkspaceSearchResponse.create({
					results: mockItems.map((item) => WorkspaceSearchResult.create(item)),
				}),
			)

			const result = await searchService.searchWorkspaceFiles("", "/workspace", 2)

			should(result).be.an.Array()
			should(result).have.length(2)
			should(result).deepEqual(mockItems)

			// Verify the host bridge was called with proper proto request
			should(mockHostBridgeProvider.searchClient.searchWorkspaceFiles.calledOnce).be.true()
			const callArgs = mockHostBridgeProvider.searchClient.searchWorkspaceFiles.getCall(0).args[0]
			should(callArgs).have.properties({
				query: "",
				workspacePath: "/workspace",
				limit: 2,
			})
		})

		it("should handle non-empty query and verify proto request", async function () {
			const mockItems: { path: string; type: "file" | "folder"; label?: string }[] = [
				{ path: "folder1/important.js", type: "file", label: "important.js" },
			]

			// Mock the host bridge to return the fuzzy search result
			mockHostBridgeProvider.searchClient.searchWorkspaceFiles.resolves(
				WorkspaceSearchResponse.create({
					results: mockItems.map((item) => WorkspaceSearchResult.create(item)),
				}),
			)

			const result = await searchService.searchWorkspaceFiles("imp", "/workspace", 10)

			should(result).be.an.Array()
			should(result).have.length(1)
			should(result[0]).have.properties({
				path: "folder1/important.js",
				type: "file",
				label: "important.js",
			})

			// Verify the proto request was constructed correctly
			const callArgs = mockHostBridgeProvider.searchClient.searchWorkspaceFiles.getCall(0).args[0]
			should(callArgs).have.properties({
				query: "imp",
				workspacePath: "/workspace",
				limit: 10,
			})
		})

		it("should use default limit when not specified", async function () {
			mockHostBridgeProvider.searchClient.searchWorkspaceFiles.resolves(WorkspaceSearchResponse.create({ results: [] }))

			await searchService.searchWorkspaceFiles("test", "/workspace")

			const callArgs = mockHostBridgeProvider.searchClient.searchWorkspaceFiles.getCall(0).args[0]
			should(callArgs.limit).equal(20) // Default limit
		})
	})

	describe("regexSearchFiles", function () {
		it("should call host bridge with proper proto request and return result", async function () {
			const expectedResult = "file1.txt:1:match\nfile2.js:5:another match"

			mockHostBridgeProvider.searchClient.regexSearchFiles.resolves(String.create({ value: expectedResult }))

			const result = await searchService.regexSearchFiles("/workspace", "/workspace/src", "test.*pattern", "*.ts")

			should(result).equal(expectedResult)

			// Verify the host bridge was called with proper proto request
			should(mockHostBridgeProvider.searchClient.regexSearchFiles.calledOnce).be.true()
			const callArgs = mockHostBridgeProvider.searchClient.regexSearchFiles.getCall(0).args[0]
			should(callArgs).have.properties({
				cwd: "/workspace",
				directoryPath: "/workspace/src",
				regex: "test.*pattern",
				filePattern: "*.ts",
				ignorePatterns: [],
			})
		})

		it("should handle ignore patterns when provided", async function () {
			const mockIgnoreController = {
				getIgnorePatterns: sandbox.stub().returns(["node_modules/**", "*.log"]),
			}

			mockHostBridgeProvider.searchClient.regexSearchFiles.resolves(String.create({ value: "result" }))

			await searchService.regexSearchFiles(
				"/workspace",
				"/workspace/src",
				"pattern",
				undefined,
				mockIgnoreController as any,
			)

			const callArgs = mockHostBridgeProvider.searchClient.regexSearchFiles.getCall(0).args[0]
			should(callArgs.ignorePatterns).deepEqual(["node_modules/**", "*.log"])
			should(callArgs.filePattern).be.undefined()
		})

		it("should handle missing ignore controller", async function () {
			mockHostBridgeProvider.searchClient.regexSearchFiles.resolves(String.create({ value: "result" }))

			await searchService.regexSearchFiles("/workspace", "/workspace/src", "pattern")

			const callArgs = mockHostBridgeProvider.searchClient.regexSearchFiles.getCall(0).args[0]
			should(callArgs.ignorePatterns).deepEqual([])
		})
	})

	describe("getBinPath", function () {
		it("should call host bridge with proper proto request and return binary path", async function () {
			const expectedPath = "/usr/local/bin/rg"

			mockHostBridgeProvider.searchClient.getBinPath.resolves(String.create({ value: expectedPath }))

			const result = await searchService.getBinPath("/app/root")

			should(result).equal(expectedPath)

			// Verify the host bridge was called with proper proto request
			should(mockHostBridgeProvider.searchClient.getBinPath.calledOnce).be.true()
			const callArgs = mockHostBridgeProvider.searchClient.getBinPath.getCall(0).args[0]
			should(callArgs).have.properties({
				value: "/app/root",
			})
		})

		it("should return undefined when host bridge returns empty value", async function () {
			mockHostBridgeProvider.searchClient.getBinPath.resolves(String.create({ value: "" }))

			const result = await searchService.getBinPath("/app/root")

			should(result).be.undefined()
		})

		it("should return undefined when host bridge returns null value", async function () {
			mockHostBridgeProvider.searchClient.getBinPath.resolves(String.create({ value: null as any }))

			const result = await searchService.getBinPath("/app/root")

			should(result).be.undefined()
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
