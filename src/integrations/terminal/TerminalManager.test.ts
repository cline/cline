// TerminalManager.test.ts
import { describe, it, expect, vi, afterAll } from 'vitest';
import * as vscode from 'vscode';
import { TerminalManager } from './TerminalManager';
import { TerminalInfo } from './TerminalRegistry';
import pWaitFor from 'p-wait-for';

vi.mock('p-wait-for', () => ({
  default: vi.fn().mockImplementation((condition, options) => {
    return new Promise<void>((resolve, reject) => {
      // Your mock implementation here
    });
  })
}));


// Mock dependencies
const pWaitForModule = await vi.importActual<typeof import('p-wait-for')>('p-wait-for');
vi.mock('p-wait-for', () => ({
  pWaitFor: vi.fn().mockImplementation((condition, options) => {
    return new Promise<void>((resolve, reject) => {
      // Your mock implementation here
    });
  }),
  
}));

vi.mock('vscode', async () => {
  const actualVscode = await vi.importActual<typeof import('vscode')>('vscode');
  return {
    ...actualVscode,
    window: {
      ...actualVscode.window,
      onDidStartTerminalShellExecution: vi.fn(),
    },
  };
});

vi.mock('./TerminalRegistry', () => ({
  TerminalRegistry: {
    removeTerminal: vi.fn()
  }
}));

describe('TerminalManager Constructor', () => {
  afterAll(() => {
    vi.resetAllMocks();
  });

  it('should handle undefined onDidStartTerminalShellExecution', () => {
    // @ts-ignore
    vi.spyOn(vscode.window, 'onDidStartTerminalShellExecution', 'get').mockReturnValue(undefined);

    // This should not throw an error
    const terminalManager = new TerminalManager();

    // Verify no disposables were added
    expect(terminalManager['disposables'].length).toBe(0);
  });

  it('should add disposable when onDidStartTerminalShellExecution is available', () => {
    // Mock the method to return a function
    const mockDisposable = { dispose: vi.fn() };
    const mockRead = vi.fn();

    // @ts-ignore
    vi.spyOn(vscode.window, 'onDidStartTerminalShellExecution', 'get').mockReturnValue(
      // @ts-ignore
      vi.fn().mockImplementation((callback) => {
        // Simulate calling the callback
        callback({ execution: { read: mockRead } });
        return mockDisposable;
      })
    );

    const terminalManager = new TerminalManager();

    // Verify disposable was added
    expect(terminalManager['disposables'].length).toBe(1);
    expect(mockRead).toHaveBeenCalled();
  });
});

describe('TerminalManager runCommand', () => {
  afterAll(() => {
    vi.resetAllMocks();
  });

  it('should run command immediately when shell integration is active', async () => {
    const terminalManager = new TerminalManager();
    
    // Create mock terminal info
    const mockTerminal = {
      shellIntegration: true,
      sendText: vi.fn()
    };
    const mockTerminalInfo: TerminalInfo = {
      id: 1,
      terminal: mockTerminal as any,
      busy: false,
      lastCommand: ''
    };

    const mockCommand = 'test command';

    // @ts-ignore
    const processSpy = vi.spyOn(terminalManager['processes'], 'set').mockImplementation(() => {});
    // @ts-ignore
    const processGetSpy = vi.spyOn(terminalManager['processes'], 'get').mockReturnValue({
      once: vi.fn(),
      run: vi.fn(),
      waitForShellIntegration: true
    });

    // Run the command
    const processPromise = terminalManager.runCommand(mockTerminalInfo, mockCommand);

    // Verify terminal info was updated
    expect(mockTerminalInfo.busy).toBe(true);
    expect(mockTerminalInfo.lastCommand).toBe(mockCommand);

    // Get the mocked process
    const mockProcess = processGetSpy.mock.results[0].value;

    // Verify process was created and run
    expect(mockProcess.run).toHaveBeenCalledWith(mockTerminal, mockCommand);
    expect(mockProcess.waitForShellIntegration).toBe(false);
  });

  
});