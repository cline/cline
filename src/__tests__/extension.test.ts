import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate } from '../extension';

const outputChannelMock = {
  appendLine: vi.fn(),
  dispose: vi.fn(),
};

describe('VS Code Extension', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mock('vscode', () => ({
      ...vscode,
      window: {
        ...vscode.window,
        createOutputChannel: () => outputChannelMock,
      },
    }));
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
      extensionUri: {} as any,
      storageUri: undefined,
      globalStorageUri: {} as any,
      logUri: {} as any,
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
      extensionUri: {} as any,
      storageUri: undefined,
      globalStorageUri: {} as any,
      logUri: {} as any,
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
