// TerminalManager.test.ts
import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from 'vitest';
import * as vscode from 'vscode';
import { TerminalManager } from './TerminalManager';
import { TerminalRegistry, TerminalInfo } from './TerminalRegistry';

// Partial mocking of vscode module
vi.mock('vscode', async () => {
  const actualVscode = await vi.importActual<typeof import('vscode')>('vscode');
  return {
    ...actualVscode,
    window: {
      ...actualVscode.window,
      onDidStartTerminalShellExecution: vi.fn(),
    },
  };
})

describe('TerminalManager Constructor', () => {
  afterAll(() => {
    vi.resetAllMocks();
  });


  it('should handle undefined onDidStartTerminalShellExecution', () => {

    // This should not throw an error
    const terminalManager = new TerminalManager();
    // set the onDidStartTerminalShellExecution to undefined
    // @ts-ignore
    vi.spyOn(vscode.window, 'onDidStartTerminalShellExecution', 'get').mockReturnValue(undefined);

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