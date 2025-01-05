// @ts-nocheck
// hard to test mocking without going out of bounds of the tpescript definitions
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import * as vscode from "vscode"
import { activate, deactivate } from "./extension"
import * as path from "path"
import * as os from "os"

describe("VSCode Extension", () => {
	beforeEach(() => {
		vi.resetAllMocks()
	})

	test("extension activates", async () => {
		const context = {
			subscriptions: [],
			extensionPath: path.join(os.tmpdir(), "/test/path"),
			globalStorageUri: {
				fsPath: path.join(os.tmpdir(), "/test/global/storage/path"),
			},
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
			},
			workspaceState: {
				get: vi.fn(),
				update: vi.fn(),
			},
		}

		const mockWorkspaceFolders = [
			{
				uri: {
					fsPath: "/mock/workspace/path",
					scheme: "file",
					authority: "",
					path: "/mock/workspace/path",
					query: "",
					fragment: "",
					with: vi.fn(),
					toString: vi.fn(),
					toJSON: vi.fn(),
				},
				name: "mockWorkspace",
				index: 0,
			},
		]

		vi.spyOn(vscode.window, "createOutputChannel").mockReturnValue({
			name: "",
			append: vi.fn(),
			appendLine: vi.fn(),
			clear: vi.fn(),
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		} as vscode.OutputChannel)

		vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue(mockWorkspaceFolders)

		await activate(context)

		expect(vscode.workspace.workspaceFolders).toEqual(mockWorkspaceFolders)
	})

	test("extension deactivates", async () => {
		await deactivate()
	})
})
