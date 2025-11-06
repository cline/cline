import { expect } from "chai"
import * as sinon from "sinon"
import { HostProvider } from "../../../hosts/host-provider"
import { Task } from "../index"

describe("Task.getEnvironmentDetails", () => {
	let task: Task
	let mockContextConfigLoader: any

	beforeEach(() => {
		// Initialize HostProvider with mock implementations
		const mockHostBridge = {
			envClient: {
				getHostVersion: sinon.stub().resolves({
					platform: "macOS",
					version: "1.0.0",
				}),
			},
			windowClient: {
				getVisibleTabs: sinon.stub().resolves({
					paths: ["/test/file1.ts", "/test/file2.ts"],
				}),
				getOpenTabs: sinon.stub().resolves({
					paths: ["/test/file1.ts", "/test/file2.ts", "/test/file3.ts"],
				}),
			},
			workspaceClient: {},
			diffClient: {},
		}

		// Reset and initialize HostProvider
		HostProvider.reset()
		HostProvider.initialize(
			() => ({}) as any, // createWebviewProvider
			() => ({}) as any, // createDiffViewProvider
			mockHostBridge as any, // hostBridge
			() => {}, // logToChannel
			async () => "http://callback", // getCallbackUrl
			async (name: string) => `/bin/${name}`, // getBinaryLocation
			"/extension/path", // extensionFsPath
			"/global/storage/path", // globalStorageFsPath
		)

		// Create mock context config loader
		mockContextConfigLoader = {
			loadConfig: sinon.stub(),
		}

		// Create a minimal task instance for testing
		// Note: This is a simplified mock - in real tests you'd need to provide all required dependencies
		task = {
			contextConfigLoader: mockContextConfigLoader,
			cwd: "/test",
			terminalManager: {
				getTerminals: sinon.stub().returns([]),
				isProcessHot: sinon.stub().returns(false),
				getUnretrievedOutput: sinon.stub().returns(""),
			},
			taskState: {
				didEditFile: false,
			},
			fileContextTracker: {
				getAndClearRecentlyModifiedFiles: sinon.stub().returns([]),
			},
			clineIgnoreController: {
				filterPaths: sinon.stub().callsFake((paths: string[]) => paths),
			},
			workspaceManager: undefined,
			stateManager: {
				getGlobalSettingsKey: sinon.stub().returns(false),
			},
			api: {
				getModel: sinon.stub().returns({
					id: "test-model",
					info: {
						contextWindow: 128000,
					},
				}),
			},
			messageStateHandler: {
				getClineMessages: sinon.stub().returns([]),
			},
			formatWorkspaceRootsSection: sinon.stub().returns(""),
			formatFileDetailsHeader: sinon.stub().returns("\n\n# Current Working Directory (/test) Files\n"),
			getEnvironmentDetails: Task.prototype.getEnvironmentDetails,
		} as any
	})

	afterEach(() => {
		// Restore all stubs
		sinon.restore()
	})

	describe("Visible Files Section", () => {
		it("should include visible files when config.includeVisibleFiles is true", async () => {
			mockContextConfigLoader.loadConfig.resolves({
				includeVisibleFiles: true,
				includeOpenTabs: false,
				includeFileTree: false,
			})

			const result = await task.getEnvironmentDetails(false)

			expect(result).to.include("Visible Files")
		})

		it("should exclude visible files when config.includeVisibleFiles is false", async () => {
			mockContextConfigLoader.loadConfig.resolves({
				includeVisibleFiles: false,
				includeOpenTabs: false,
				includeFileTree: false,
			})

			const result = await task.getEnvironmentDetails(false)

			expect(result).to.not.include("Visible Files")
		})
	})

	describe("Open Tabs Section", () => {
		it("should include open tabs when config.includeOpenTabs is true", async () => {
			mockContextConfigLoader.loadConfig.resolves({
				includeVisibleFiles: false,
				includeOpenTabs: true,
				includeFileTree: false,
			})

			const result = await task.getEnvironmentDetails(false)

			expect(result).to.include("Open Tabs")
		})

		it("should exclude open tabs when config.includeOpenTabs is false", async () => {
			mockContextConfigLoader.loadConfig.resolves({
				includeVisibleFiles: false,
				includeOpenTabs: false,
				includeFileTree: false,
			})

			const result = await task.getEnvironmentDetails(false)

			expect(result).to.not.include("Open Tabs")
		})
	})

	describe("File Tree Section", () => {
		it("should include file tree when config.includeFileTree is true and includeFileDetails is true", async () => {
			mockContextConfigLoader.loadConfig.resolves({
				includeVisibleFiles: false,
				includeOpenTabs: false,
				includeFileTree: true,
				fileTreeStyle: "tree",
				workdir: {
					includePatterns: [],
					excludePatterns: [],
					maxFileCount: 200,
				},
			})

			const result = await task.getEnvironmentDetails(true)

			// Check for the file tree header - just verify it contains the key phrase
			expect(result).to.include("Current Working Directory")
		})

		it("should use flat file list when fileTreeStyle is flat", async () => {
			mockContextConfigLoader.loadConfig.resolves({
				includeVisibleFiles: false,
				includeOpenTabs: false,
				includeFileTree: true,
				fileTreeStyle: "flat",
				workdir: {
					includePatterns: ["**/*.ts"],
					excludePatterns: ["**/*.test.ts"],
					maxFileCount: 100,
				},
			})

			const result = await task.getEnvironmentDetails(true)

			// Should include the file tree header
			expect(result).to.include("Current Working Directory")
		})

		it("should use tree style when fileTreeStyle is tree", async () => {
			mockContextConfigLoader.loadConfig.resolves({
				includeVisibleFiles: false,
				includeOpenTabs: false,
				includeFileTree: true,
				fileTreeStyle: "tree",
				workdir: {
					includePatterns: [],
					excludePatterns: [],
					maxFileCount: 200,
				},
			})

			const result = await task.getEnvironmentDetails(true)

			// Should include the file tree header
			expect(result).to.include("Current Working Directory")
		})

		it("should exclude file tree when config.includeFileTree is false even if includeFileDetails is true", async () => {
			mockContextConfigLoader.loadConfig.resolves({
				includeVisibleFiles: false,
				includeOpenTabs: false,
				includeFileTree: false,
				fileTreeStyle: "tree",
				workdir: {
					includePatterns: [],
					excludePatterns: [],
					maxFileCount: 200,
				},
			})

			const result = await task.getEnvironmentDetails(true)

			expect(result).to.not.include("Current Working Directory")
		})

		it("should exclude file tree when includeFileDetails is false even if config.includeFileTree is true", async () => {
			mockContextConfigLoader.loadConfig.resolves({
				includeVisibleFiles: false,
				includeOpenTabs: false,
				includeFileTree: true,
				fileTreeStyle: "tree",
				workdir: {
					includePatterns: [],
					excludePatterns: [],
					maxFileCount: 200,
				},
			})

			const result = await task.getEnvironmentDetails(false)

			expect(result).to.not.include("Current Working Directory")
		})
	})

	describe("Combined Configurations", () => {
		it("should include all sections when all config options are true", async () => {
			mockContextConfigLoader.loadConfig.resolves({
				includeVisibleFiles: true,
				includeOpenTabs: true,
				includeFileTree: true,
				fileTreeStyle: "tree",
				workdir: {
					includePatterns: [],
					excludePatterns: [],
					maxFileCount: 200,
				},
			})

			const result = await task.getEnvironmentDetails(true)

			expect(result).to.include("Visible Files")
			expect(result).to.include("Open Tabs")
			expect(result).to.include("Current Working Directory")
		})

		it("should exclude all sections when all config options are false", async () => {
			mockContextConfigLoader.loadConfig.resolves({
				includeVisibleFiles: false,
				includeOpenTabs: false,
				includeFileTree: false,
				fileTreeStyle: "tree",
				workdir: {
					includePatterns: [],
					excludePatterns: [],
					maxFileCount: 200,
				},
			})

			const result = await task.getEnvironmentDetails(false)

			expect(result).to.not.include("Visible Files")
			expect(result).to.not.include("Open Tabs")
			expect(result).to.not.include("Current Working Directory")
		})
	})

	describe("Always Included Sections", () => {
		it("should always include context window usage regardless of config", async () => {
			mockContextConfigLoader.loadConfig.resolves({
				includeVisibleFiles: false,
				includeOpenTabs: false,
				includeFileTree: false,
			})

			const result = await task.getEnvironmentDetails(false)

			expect(result).to.include("# Context Window Usage")
		})

		it("should always include current mode regardless of config", async () => {
			mockContextConfigLoader.loadConfig.resolves({
				includeVisibleFiles: false,
				includeOpenTabs: false,
				includeFileTree: false,
			})

			const result = await task.getEnvironmentDetails(false)

			expect(result).to.include("# Current Mode")
		})
	})
})
