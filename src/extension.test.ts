import { afterEach, describe, expect, test, vi } from "vitest";
import { vscode } from "../tests/vscode-mocks";
const { workspace, window } = vscode;
import { activate, deactivate } from "./extension"

describe("VSCode Extension", () => {
  
  afterEach(() => {
    vi.resetAllMocks()
  })

  test("extension activates", () => {
    
    const context = {
      subscriptions: [],
      extensionPath: "/test/path",
      globalState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
    };

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

    vi.spyOn(workspace, "workspaceFolders", "get").mockReturnValue(mockWorkspaceFolders)

    activate(context)
    
    expect(workspace.workspaceFolders).toBeDefined()
    
  })

  test("extension deactivates", () => {
    deactivate()
  })
})
