// tests/TerminalManager.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TerminalManager } from './TerminalManager';
import { TerminalInfo } from './TerminalRegistry';
import { TerminalProcess, mergePromise, TerminalProcessResultPromise } from './TerminalProcess';

// Mocking external modules
vi.mock('vscode', () => ({
  window: {
    onDidStartTerminalShellExecution: vi.fn(),
  },
  Uri: {
    file: vi.fn((path: string) => ({
      fsPath: path,
    })),
  },
  Disposable: vi.fn(),
}));

vi.mock('./TerminalRegistry', () => ({
  TerminalRegistry: {
    getAllTerminals: vi.fn(),
    createTerminal: vi.fn(),
    removeTerminal: vi.fn(),
    getTerminal: vi.fn(),
  },
}));

vi.mock('./TerminalProcess', () => ({
  TerminalProcess: vi.fn().mockImplementation(() => ({
    once: vi.fn(),
    on: vi.fn(),
    getUnretrievedOutput: vi.fn(),
    isHot: false,
    run: vi.fn(),
    waitForShellIntegration: true,
  })),
  mergePromise: vi.fn((process: any, promise: Promise<any>) => promise),
  TerminalProcessResultPromise: vi.fn(),
}));

describe('TerminalManager', () => {
  let terminalManager: TerminalManager;

  beforeEach(() => {
    terminalManager = new TerminalManager();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should create an instance of TerminalManager', () => {
    expect(terminalManager).toBeInstanceOf(TerminalManager);
  });

  it('should have a runCommand method', () => {
    expect(typeof terminalManager.runCommand).toBe('function');
  });

  it('should have a getOrCreateTerminal method', () => {
    expect(typeof terminalManager.getOrCreateTerminal).toBe('function');
  });

  it('should have a getTerminals method', () => {
    expect(typeof terminalManager.getTerminals).toBe('function');
  });

  it('should have a getUnretrievedOutput method', () => {
    expect(typeof terminalManager.getUnretrievedOutput).toBe('function');
  });

  it('should have an isProcessHot method', () => {
    expect(typeof terminalManager.isProcessHot).toBe('function');
  });

  it('should have a disposeAll method', () => {
    expect(typeof terminalManager.disposeAll).toBe('function');
  });

  // Example of mocking method calls without executing their implementations
  it('should call runCommand without executing its implementation', async () => {
    const mockRunCommand = vi.spyOn(terminalManager, 'runCommand').mockImplementation(() => {
      // Mock implementation can return a dummy promise or value
      return Promise.resolve() as unknown as TerminalProcessResultPromise;
    });

    const terminalInfo: TerminalInfo = { id: 1, busy: false, lastCommand: '', terminal: {} as any };
    const command = 'echo Hello World';

    await terminalManager.runCommand(terminalInfo, command);

    expect(mockRunCommand).toHaveBeenCalledWith(terminalInfo, command);

    // Restore the original implementation if needed
    mockRunCommand.mockRestore();
  });

  // Similarly, you can add more tests to ensure other methods are callable
});