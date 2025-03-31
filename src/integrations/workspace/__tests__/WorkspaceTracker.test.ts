import * as vscode from "vscode"
import WorkspaceTracker from "../WorkspaceTracker"
import { ClineProvider } from "../../../core/webview/ClineProvider"
import { listFiles } from "../../../services/glob/list-files"
import { getWorkspacePath } from "../../../utils/path"

// Mock functions - must be defined before jest.mock calls
const mockOnDidCreate = jest.fn()
const mockOnDidDelete = jest.fn()
const mockDispose = jest.fn()

// Store registered tab change callback
let registeredTabChangeCallback: (() => Promise<void>) | null = null

// Mock workspace path
jest.mock("../../../utils/path", () => ({
	getWorkspacePath: jest.fn().mockReturnValue("/test/workspace"),
	toRelativePath: jest.fn((path, cwd) => path.replace(`${cwd}/`, "")),
}))

// Mock watcher - must be defined after mockDispose but before jest.mock("vscode")
const mockWatcher = {
	onDidCreate: mockOnDidCreate.mockReturnValue({ dispose: mockDispose }),
	onDidDelete: mockOnDidDelete.mockReturnValue({ dispose: mockDispose }),
	dispose: mockDispose,
}

// Mock vscode
jest.mock("vscode", () => ({
	window: {
		tabGroups: {
			onDidChangeTabs: jest.fn((callback) => {
				registeredTabChangeCallback = callback
				return { dispose: mockDispose }
			}),
			all: [],
		},
		onDidChangeActiveTextEditor: jest.fn(() => ({ dispose: jest.fn() })),
	},
	workspace: {
		workspaceFolders: [
			{
				uri: { fsPath: "/test/workspace" },
				name: "test",
				index: 0,
			},
		],
		createFileSystemWatcher: jest.fn(() => mockWatcher),
		fs: {
			stat: jest.fn().mockResolvedValue({ type: 1 }), // FileType.File = 1
		},
	},
	FileType: { File: 1, Directory: 2 },
}))

jest.mock("../../../services/glob/list-files")

describe("WorkspaceTracker", () => {
	let workspaceTracker: WorkspaceTracker
	let mockProvider: ClineProvider

	beforeEach(() => {
		jest.clearAllMocks()
		jest.useFakeTimers()

		// Reset all mock implementations
		registeredTabChangeCallback = null

		// Reset workspace path mock
		;(getWorkspacePath as jest.Mock).mockReturnValue("/test/workspace")

		// Create provider mock
		mockProvider = {
			postMessageToWebview: jest.fn().mockResolvedValue(undefined),
		} as unknown as ClineProvider & { postMessageToWebview: jest.Mock }

		// Create tracker instance
		workspaceTracker = new WorkspaceTracker(mockProvider)

		// Ensure the tab change callback was registered
		expect(registeredTabChangeCallback).not.toBeNull()
	})

	it("should initialize with workspace files", async () => {
		const mockFiles = [["/test/workspace/file1.ts", "/test/workspace/file2.ts"], false]
		;(listFiles as jest.Mock).mockResolvedValue(mockFiles)

		await workspaceTracker.initializeFilePaths()
		jest.runAllTimers()

		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "workspaceUpdated",
			filePaths: expect.arrayContaining(["file1.ts", "file2.ts"]),
			openedTabs: [],
		})
		expect((mockProvider.postMessageToWebview as jest.Mock).mock.calls[0][0].filePaths).toHaveLength(2)
	})

	it("should handle file creation events", async () => {
		// Get the creation callback and call it
		const [[callback]] = mockOnDidCreate.mock.calls
		await callback({ fsPath: "/test/workspace/newfile.ts" })
		jest.runAllTimers()

		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "workspaceUpdated",
			filePaths: ["newfile.ts"],
			openedTabs: [],
		})
	})

	it("should handle file deletion events", async () => {
		// First add a file
		const [[createCallback]] = mockOnDidCreate.mock.calls
		await createCallback({ fsPath: "/test/workspace/file.ts" })
		jest.runAllTimers()

		// Then delete it
		const [[deleteCallback]] = mockOnDidDelete.mock.calls
		await deleteCallback({ fsPath: "/test/workspace/file.ts" })
		jest.runAllTimers()

		// The last call should have empty filePaths
		expect(mockProvider.postMessageToWebview).toHaveBeenLastCalledWith({
			type: "workspaceUpdated",
			filePaths: [],
			openedTabs: [],
		})
	})

	it("should handle directory paths correctly", async () => {
		// Mock stat to return directory type
		;(vscode.workspace.fs.stat as jest.Mock).mockResolvedValueOnce({ type: 2 }) // FileType.Directory = 2

		const [[callback]] = mockOnDidCreate.mock.calls
		await callback({ fsPath: "/test/workspace/newdir" })
		jest.runAllTimers()

		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "workspaceUpdated",
			filePaths: expect.arrayContaining(["newdir"]),
			openedTabs: [],
		})
		const lastCall = (mockProvider.postMessageToWebview as jest.Mock).mock.calls.slice(-1)[0]
		expect(lastCall[0].filePaths).toHaveLength(1)
	})

	it("should respect file limits", async () => {
		// Create array of unique file paths for initial load
		const files = Array.from({ length: 1001 }, (_, i) => `/test/workspace/file${i}.ts`)
		;(listFiles as jest.Mock).mockResolvedValue([files, false])

		await workspaceTracker.initializeFilePaths()
		jest.runAllTimers()

		// Should only have 1000 files initially
		const expectedFiles = Array.from({ length: 1000 }, (_, i) => `file${i}.ts`).sort()
		const calls = (mockProvider.postMessageToWebview as jest.Mock).mock.calls

		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "workspaceUpdated",
			filePaths: expect.arrayContaining(expectedFiles),
			openedTabs: [],
		})
		expect(calls[0][0].filePaths).toHaveLength(1000)

		// Should allow adding up to 2000 total files
		const [[callback]] = mockOnDidCreate.mock.calls
		for (let i = 0; i < 1000; i++) {
			await callback({ fsPath: `/test/workspace/extra${i}.ts` })
		}
		jest.runAllTimers()

		const lastCall = (mockProvider.postMessageToWebview as jest.Mock).mock.calls.slice(-1)[0]
		expect(lastCall[0].filePaths).toHaveLength(2000)

		// Adding one more file beyond 2000 should not increase the count
		await callback({ fsPath: "/test/workspace/toomany.ts" })
		jest.runAllTimers()

		const finalCall = (mockProvider.postMessageToWebview as jest.Mock).mock.calls.slice(-1)[0]
		expect(finalCall[0].filePaths).toHaveLength(2000)
	})

	it("should clean up watchers and timers on dispose", () => {
		// Set up updateTimer
		const [[callback]] = mockOnDidCreate.mock.calls
		callback({ fsPath: "/test/workspace/file.ts" })

		workspaceTracker.dispose()
		expect(mockDispose).toHaveBeenCalled()
		jest.runAllTimers() // Ensure any pending timers are cleared

		// No more updates should happen after dispose
		expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
	})

	it("should handle workspace path changes when tabs change", async () => {
		expect(registeredTabChangeCallback).not.toBeNull()

		// Set initial workspace path and create tracker
		;(getWorkspacePath as jest.Mock).mockReturnValue("/test/workspace")
		workspaceTracker = new WorkspaceTracker(mockProvider)

		// Clear any initialization calls
		jest.clearAllMocks()

		// Mock listFiles to return some files
		const mockFiles = [["/test/new-workspace/file1.ts"], false]
		;(listFiles as jest.Mock).mockResolvedValue(mockFiles)

		// Change workspace path
		;(getWorkspacePath as jest.Mock).mockReturnValue("/test/new-workspace")

		// Simulate tab change event
		await registeredTabChangeCallback!()

		// Run the debounce timer for workspaceDidReset
		jest.advanceTimersByTime(300)

		// Should clear file paths and reset workspace
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "workspaceUpdated",
			filePaths: [],
			openedTabs: [],
		})

		// Run all remaining timers to complete initialization
		await Promise.resolve() // Wait for initializeFilePaths to complete
		jest.runAllTimers()

		// Should initialize file paths for new workspace
		expect(listFiles).toHaveBeenCalledWith("/test/new-workspace", true, 1000)
		jest.runAllTimers()
	})

	it("should not update file paths if workspace changes during initialization", async () => {
		// Setup initial workspace path
		;(getWorkspacePath as jest.Mock).mockReturnValue("/test/workspace")
		workspaceTracker = new WorkspaceTracker(mockProvider)

		// Clear any initialization calls
		jest.clearAllMocks()
		;(mockProvider.postMessageToWebview as jest.Mock).mockClear()

		// Create a promise to control listFiles timing
		let resolveListFiles: (value: [string[], boolean]) => void
		const listFilesPromise = new Promise<[string[], boolean]>((resolve) => {
			resolveListFiles = resolve
		})

		// Setup listFiles to use our controlled promise
		;(listFiles as jest.Mock).mockImplementation(() => {
			// Change workspace path before listFiles resolves
			;(getWorkspacePath as jest.Mock).mockReturnValue("/test/changed-workspace")
			return listFilesPromise
		})

		// Start initialization
		const initPromise = workspaceTracker.initializeFilePaths()

		// Resolve listFiles after workspace path change
		resolveListFiles!([["/test/workspace/file1.ts", "/test/workspace/file2.ts"], false])

		// Wait for initialization to complete
		await initPromise
		jest.runAllTimers()

		// Should not update file paths because workspace changed during initialization
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			filePaths: ["/test/workspace/file1.ts", "/test/workspace/file2.ts"],
			openedTabs: [],
			type: "workspaceUpdated",
		})
	})

	it("should clear resetTimer when calling workspaceDidReset multiple times", async () => {
		expect(registeredTabChangeCallback).not.toBeNull()

		// Set initial workspace path
		;(getWorkspacePath as jest.Mock).mockReturnValue("/test/workspace")

		// Create tracker instance to set initial prevWorkSpacePath
		workspaceTracker = new WorkspaceTracker(mockProvider)

		// Change workspace path to trigger update
		;(getWorkspacePath as jest.Mock).mockReturnValue("/test/new-workspace")

		// Call workspaceDidReset through tab change event
		await registeredTabChangeCallback!()

		// Call again before timer completes
		await registeredTabChangeCallback!()

		// Advance timer
		jest.advanceTimersByTime(300)

		// Should only have one call to postMessageToWebview
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "workspaceUpdated",
			filePaths: [],
			openedTabs: [],
		})
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledTimes(1)
	})

	it("should handle dispose with active resetTimer", async () => {
		expect(registeredTabChangeCallback).not.toBeNull()

		// Mock workspace path change to trigger resetTimer
		;(getWorkspacePath as jest.Mock)
			.mockReturnValueOnce("/test/workspace")
			.mockReturnValueOnce("/test/new-workspace")

		// Trigger resetTimer
		await registeredTabChangeCallback!()

		// Dispose before timer completes
		workspaceTracker.dispose()

		// Advance timer
		jest.advanceTimersByTime(300)

		// Should have called dispose on all disposables
		expect(mockDispose).toHaveBeenCalled()

		// No postMessage should be called after dispose
		expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
	})
})
