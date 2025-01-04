import { vi } from 'vitest';

export const createVSCodeMock = () => {
  const windowMock = {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createOutputChannel: vi.fn().mockReturnValue({
      append: vi.fn(),
      appendLine: vi.fn(),
      show: vi.fn(),
      clear: vi.fn(),
    }),
  };

  const workspaceMock = {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn(),
      update: vi.fn(),
    }),
    onDidChangeConfiguration: vi.fn(),
    workspaceFolders: [],
  };

  const commandsMock = {
    registerCommand: vi.fn(),
    executeCommand: vi.fn(),
  };

  return {
    window: windowMock,
    workspace: workspaceMock,
    commands: commandsMock,
  };
};

// Global mock for vscode module
vi.mock('vscode', () => createVSCodeMock());
