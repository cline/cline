import { vi } from 'vitest';
import * as vscode from 'vscode';

export const createMockVSCodeModule = () => ({
  // Mock vscode namespace
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      dispose: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
    })),
    createTextEditorDecorationType: vi.fn(),
    registerWebviewViewProvider: vi.fn(),
    createWebviewPanel: vi.fn(() => ({
      webview: {
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn(),
        html: '',
      },
      reveal: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  commands: {
    registerCommand: vi.fn((commandId: string, callback: (...args: any[]) => any) => {
      return {
        commandId,
        callback,
        dispose: vi.fn(),
      };
    }),
    executeCommand: vi.fn(),
  },
  extensions: {
    getExtension: vi.fn(),
  },
  workspace: {
    workspaceFolders: [],
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, defaultValue?: any) => defaultValue),
      update: vi.fn(),
    })),
    onDidChangeConfiguration: vi.fn(),
    onDidCreateFiles: vi.fn(),
    onDidDeleteFiles: vi.fn(),
    onDidRenameFiles: vi.fn(),
    registerTextDocumentContentProvider: vi.fn((scheme: string, provider: vscode.TextDocumentContentProvider) => {
      // Simulate the behavior of registerTextDocumentContentProvider
      return {
        scheme,
        provider,
        dispose: vi.fn(),
      };
    }),
  },
  Uri: {
    parse: vi.fn((value: string) => ({ 
      path: value, 
      fsPath: value,
      toString: vi.fn(() => value),
      with: vi.fn(),
      scheme: 'file',
      authority: '',
      query: '',
      fragment: '',
      toJSON: vi.fn(() => ({ path: value })),
    })),
    file: vi.fn((value: string) => ({ 
      path: value, 
      fsPath: value,
      toString: vi.fn(() => value),
      with: vi.fn(),
      scheme: 'file',
      authority: '',
      query: '',
      fragment: '',
      toJSON: vi.fn(() => ({ path: value })),
    })),
    joinPath: vi.fn(),
  },
  ExtensionMode: {
    Production: 1,
    Development: 2,
    Test: 3,
  },
  EventEmitter: vi.fn(() => ({
    event: vi.fn(),
    fire: vi.fn(),
    dispose: vi.fn(),
  })),
});

export const createMockExtensionContext = (): vscode.ExtensionContext => {
  const mockMemento = {
    get: vi.fn((key: string) => undefined),
    update: vi.fn((key: string, value: any) => Promise.resolve()),
    keys: vi.fn(() => []),
  };

  return {
    subscriptions: [],
    workspaceState: mockMemento,
    globalState: {
      ...mockMemento,
      setKeysForSync: vi.fn((keys: readonly string[]) => {}),
    },
    secrets: {
      get: vi.fn((key: string) => Promise.resolve(undefined)),
      store: vi.fn((key: string, value: string) => Promise.resolve()),
      delete: vi.fn((key: string) => Promise.resolve()),
      onDidChange: vi.fn(),
    },
    extensionPath: '',
    storagePath: '',
    globalStoragePath: '',
    logPath: '',
    asAbsolutePath: vi.fn(),
    extensionUri: createMockVSCodeModule().Uri.parse('file:///test/extension'),
    storageUri: createMockVSCodeModule().Uri.parse('file:///test/storage'),
    globalStorageUri: createMockVSCodeModule().Uri.parse('file:///test/global-storage'),
    logUri: createMockVSCodeModule().Uri.parse('file:///test/logs'),
    environmentVariableCollection: {} as any,
    extensionMode: vscode.ExtensionMode.Test,
    extension: {
      id: 'test-extension',
      extensionPath: '',
      isActive: true,
      packageJSON: {},
      extensionKind: vscode.ExtensionKind.Workspace,
      exports: {},
      activate: vi.fn(),
      extensionUri: createMockVSCodeModule().Uri.parse('file:///test/extension')
    },
  };
};
