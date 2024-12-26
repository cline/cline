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

        // Create provider mock
        mockProvider = { postMessageToWebview: jest.fn() } as any

        // Create tracker instance
        workspaceTracker = new WorkspaceTracker(mockProvider)
    })

    it("should initialize with workspace files", async () => {
        const mockFiles = [["/test/workspace/file1.ts", "/test/workspace/file2.ts"], false]
        ;(listFiles as jest.Mock).mockResolvedValue(mockFiles)
        
        await workspaceTracker.initializeFilePaths()

        expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
            type: "workspaceUpdated",
            filePaths: ["file1.ts", "file2.ts"]
        })
    })

    it("should handle file creation events", async () => {
        // Get the creation callback and call it
        const [[callback]] = mockOnDidCreate.mock.calls
        await callback({ fsPath: "/test/workspace/newfile.ts" })

        expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
            type: "workspaceUpdated",
            filePaths: ["newfile.ts"]
        })
    })

    it("should handle file deletion events", async () => {
        // First add a file
        const [[createCallback]] = mockOnDidCreate.mock.calls
        await createCallback({ fsPath: "/test/workspace/file.ts" })
        
        // Then delete it
        const [[deleteCallback]] = mockOnDidDelete.mock.calls
        await deleteCallback({ fsPath: "/test/workspace/file.ts" })

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

        expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
            type: "workspaceUpdated",
            filePaths: ["newdir"]
        })
    })

    it("should clean up watchers on dispose", () => {
        workspaceTracker.dispose()
        expect(mockDispose).toHaveBeenCalled()
    })
})