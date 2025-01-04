import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate, deactivate } from './extension';

// Mock the entire vscode module
vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createOutputChannel: vi.fn().mockReturnValue({
      append: vi.fn(),
      appendLine: vi.fn(),
      show: vi.fn(),
      clear: vi.fn(),
    }),
  },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn(),
      update: vi.fn(),
    }),
    onDidChangeConfiguration: vi.fn(),
    workspaceFolders: [],
  },
  commands: {
    registerCommand: vi.fn(),
    executeCommand: vi.fn(),
  },
  ExtensionContext: vi.fn(),
}));

describe('VSCode Extension', () => {
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    // Create a mock extension context
    context = {
      subscriptions: [],
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      globalState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      extensionPath: '/mock/extension/path',
      storagePath: '/mock/storage/path',
      globalStoragePath: '/mock/global/storage/path',
      logPath: '/mock/log/path',
      asAbsolutePath: vi.fn(),
    } as unknown as vscode.ExtensionContext;
  });

  it('should activate the extension', () => {
    const result = activate(context);
    expect(result).toBeDefined();
    expect(vscode.commands.registerCommand).toHaveBeenCalled();
  });

  it('should deactivate the extension', () => {
    // Deactivate typically doesn't return anything, just clean up
    expect(() => deactivate()).not.toThrow();
  });
});
