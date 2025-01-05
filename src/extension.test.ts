import { afterEach, describe, expect, test, vi, Mock, beforeEach } from "vitest";
import * as vscode from "vscode";

import { activate, deactivate } from "./extension";

describe("VSCode Extension", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  test("extension activates", async () => {
    const context = {
      subscriptions: [],
      extensionPath: "/test/path",
      globalStorageUri: {
        fsPath: "/test/global/storage/path",
      },
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
    ];
    // @ts-ignore
    vi.spyOn(vscode.window, "createOutputChannel").mockImplementation((name: string) => ({
      name,
      append: vi.fn(),
      appendLine: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    } as vscode.OutputChannel));


    vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue(mockWorkspaceFolders);

    await activate(context);

    expect(vscode.workspace.workspaceFolders).toEqual(mockWorkspaceFolders);
  });

  test("extension deactivates", async () => {
    await deactivate();
  });
});
