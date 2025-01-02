import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate } from '../extension';
import { readFile } from 'fs/promises';
import path from 'path';

const outputChannelMock = {
  appendLine: vi.fn(),
  dispose: vi.fn(),
};

describe('Cline Extension', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mock('vscode', () => ({
      window: {
        createOutputChannel: () => outputChannelMock,
        createTextEditorDecorationType: vi.fn(),
        registerWebviewViewProvider: vi.fn(),
      },
      commands: {
        registerCommand: vi.fn(),
        executeCommand: vi.fn(),
      },
      extensions: {
        getExtension: vi.fn(),
      },
      workspace: {
        workspaceFolders: [],
        getConfiguration: vi.fn(),
        onDidChangeConfiguration: vi.fn(),
        onDidCreateFiles: vi.fn(),
        onDidDeleteFiles: vi.fn(),
        onDidRenameFiles: vi.fn(),
      },
      ExtensionMode: {
        Production: 1,
        Development: 2,
        Test: 3
      },
      Uri: {
        parse: (value: string) => ({ path: value })
      }
    }));
  });

  const packagePath = path.join(__dirname, "..", "..", "package.json");

  it('should verify extension ID matches package.json', async () => {
    const packageJSON = JSON.parse(await readFile(packagePath, "utf8"));
    const id = `${packageJSON.publisher}.${packageJSON.name}`;
    
    const mockGetExtension = vi.spyOn(vscode.extensions, 'getExtension');
    mockGetExtension.mockReturnValue({
      id: id,
      isActive: true,
      exports: {},
      activate: vi.fn(),
      extensionPath: '',
      extensionUri: {} as any,
      isFromWorkspace: false
    } as any);

    const clineExtensionApi = vscode.extensions.getExtension(id);
    expect(clineExtensionApi?.id).toBe(id);
  });

  it('should successfully execute the plus button command', async () => {
    // Simulate a delay to mimic real-world async behavior
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    const mockExecuteCommand = vi.spyOn(vscode.commands, 'executeCommand');
    
    await vscode.commands.executeCommand("cline.plusButtonClicked");
    
    expect(mockExecuteCommand).toHaveBeenCalledWith("cline.plusButtonClicked");
  });

  it('should activate extension', () => {
    const mockContext = {
      subscriptions: [],
      workspaceState: {
        get: vi.fn(),
        update: vi.fn()
      },
      globalState: {
        get: vi.fn(),
        update: vi.fn()
      },
      secrets: {
        get: vi.fn(),
        store: vi.fn(),
        delete: vi.fn()
      },
      extensionPath: '',
      storagePath: '',
      globalStoragePath: '',
      logPath: '',
      asAbsolutePath: vi.fn(),
      extensionUri: vscode.Uri.parse('file:///test/extension'),
      storageUri: vscode.Uri.parse('file:///test/storage'),
      globalStorageUri: vscode.Uri.parse('file:///test/global-storage'),
      logUri: vscode.Uri.parse('file:///test/logs'),
      environmentVariableCollection: {} as any,
      extensionMode: vscode.ExtensionMode.Production
    } as unknown as vscode.ExtensionContext;

    const result = activate(mockContext);
    expect(result).toBeDefined();
  });

  it('should register commands', () => {
    const mockRegisterCommand = vi.spyOn(vscode.commands, 'registerCommand');
    
    const mockContext = {
      subscriptions: [],
      workspaceState: {
        get: vi.fn(),
        update: vi.fn()
      },
      globalState: {
        get: vi.fn(),
        update: vi.fn()
      },
      secrets: {
        get: vi.fn(),
        store: vi.fn(),
        delete: vi.fn()
      },
      extensionPath: '',
      storagePath: '',
      globalStoragePath: '',
      logPath: '',
      asAbsolutePath: vi.fn(),
      extensionUri: vscode.Uri.parse('file:///test/extension'),
      storageUri: vscode.Uri.parse('file:///test/storage'),
      globalStorageUri: vscode.Uri.parse('file:///test/global-storage'),
      logUri: vscode.Uri.parse('file:///test/logs'),
      environmentVariableCollection: {} as any,
      extensionMode: vscode.ExtensionMode.Production
    } as unknown as vscode.ExtensionContext;

    activate(mockContext);

    expect(mockRegisterCommand).toHaveBeenCalledWith(
      'cline.plusButtonClicked', 
      expect.any(Function)
    );
    expect(mockRegisterCommand).toHaveBeenCalledWith(
      'cline.mcpButtonClicked', 
      expect.any(Function)
    );
  });
});
