import * as vscode from "vscode"
import WorkspaceTracker from "../WorkspaceTracker"
import { ClineProvider } from "../../../core/webview/ClineProvider"
import { listFiles } from "../../../services/glob/list-files"

// Mock modules
const mockOnDidCreate = jest.fn()
const mockOnDidDelete = jest.fn()
const mockOnDidChange = jest.fn()
const mockDispose = jest.fn()

const mockWatcher = {
    onDidCreate: mockOnDidCreate.mockReturnValue({ dispose: mockDispose }),
    onDidDelete: mockOnDidDelete.mockReturnValue({ dispose: mockDispose }),
    dispose: mockDispose
}

jest.mock("vscode", () => ({
    workspace: {
        workspaceFolders: [{
            uri: { fsPath: "/test/workspace" },
            name: "test",
            index: 0
        }],
        createFileSystemWatcher: jest.fn(() => mockWatcher),
        fs: {
            stat: jest.fn().mockResolvedValue({ type: 1 }) // FileType.File = 1
        }
    },
    FileType: { File: 1, Directory: 2 }
}))

jest.mock("../../../services/glob/list-files")

describe("WorkspaceTracker", () => {
    let workspaceTracker: WorkspaceTracker
    let mockProvider: ClineProvider

    beforeEach(() => {
        jest.clearAllMocks()
        jest.useFakeTimers()

        // Create provider mock
        mockProvider = {
            postMessageToWebview: jest.fn().mockResolvedValue(undefined)
        } as unknown as ClineProvider & { postMessageToWebview: jest.Mock }

        // Create tracker instance
        workspaceTracker = new WorkspaceTracker(mockProvider)
    })

    it("should initialize with workspace files", async () => {
        const mockFiles = [["/test/workspace/file1.ts", "/test/workspace/file2.ts"], false]
        ;(listFiles as jest.Mock).mockResolvedValue(mockFiles)
        
        await workspaceTracker.initializeFilePaths()
        jest.runAllTimers()

        expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
            type: "workspaceUpdated",
            filePaths: expect.arrayContaining(["file1.ts", "file2.ts"])
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
            filePaths: ["newfile.ts"]
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
            filePaths: []
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
            filePaths: expect.arrayContaining(["newdir"])
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
            filePaths: expect.arrayContaining(expectedFiles)
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
        workspaceTracker.dispose()
        expect(mockDispose).toHaveBeenCalled()
        jest.runAllTimers() // Ensure any pending timers are cleared
    })
})