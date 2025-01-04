// tests/TerminalRegistry.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TerminalRegistry, TerminalInfo } from './TerminalRegistry';
import * as vscode from 'vscode';

// Mocking the vscode module
vi.mock('vscode', () => {
  // Create a mock Terminal class
  class MockTerminal {
    exitStatus?: { code: number };
    constructor() {
      this.exitStatus = undefined;
    }

    dispose = vi.fn();
    // Add other Terminal methods if needed
  }

  return {
    window: {
      createTerminal: vi.fn((options) => {
        return new MockTerminal() as unknown as vscode.Terminal;
      }),
    },
    Uri: {
      file: vi.fn((path: string) => ({
        fsPath: path,
      })),
    },
    ThemeIcon: vi.fn().mockImplementation((iconName) => ({
      id: iconName,
    })),
  };
});

describe('TerminalRegistry', () => {
  beforeEach(() => {
    // Reset the TerminalRegistry's internal state before each test
    (TerminalRegistry as any).terminals = [];
    (TerminalRegistry as any).nextTerminalId = 1;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should have a createTerminal method', () => {
    expect(typeof TerminalRegistry.createTerminal).toBe('function');
  });

  it('should have a getTerminal method', () => {
    expect(typeof TerminalRegistry.getTerminal).toBe('function');
  });

  it('should have an updateTerminal method', () => {
    expect(typeof TerminalRegistry.updateTerminal).toBe('function');
  });

  it('should have a removeTerminal method', () => {
    expect(typeof TerminalRegistry.removeTerminal).toBe('function');
  });

  it('should have a getAllTerminals method', () => {
    expect(typeof TerminalRegistry.getAllTerminals).toBe('function');
  });

  // Example of testing createTerminal
  it('should create a new terminal with correct parameters', () => {
    const cwd = '/path/to/project';
    const terminalInfo: TerminalInfo = TerminalRegistry.createTerminal(cwd);

    expect(vscode.window.createTerminal).toHaveBeenCalledWith({
      cwd,
      name: 'Cline',
      iconPath: { id: 'robot' },
    });

    expect(terminalInfo).toHaveProperty('terminal');
    expect(terminalInfo).toHaveProperty('busy', false);
    expect(terminalInfo).toHaveProperty('lastCommand', '');
    expect(terminalInfo).toHaveProperty('id', 1);
  });

  it('should increment terminal ID for each new terminal', () => {
    const terminal1 = TerminalRegistry.createTerminal();
    const terminal2 = TerminalRegistry.createTerminal();

    expect(terminal1.id).toBe(1);
    expect(terminal2.id).toBe(2);
  });

  it('should retrieve a terminal by ID', () => {
    const terminalInfo = TerminalRegistry.createTerminal();
    const retrievedTerminal = TerminalRegistry.getTerminal(terminalInfo.id);

    expect(retrievedTerminal).toBe(terminalInfo);
  });

  it('should return undefined for a non-existent terminal', () => {
    const retrievedTerminal = TerminalRegistry.getTerminal(999);
    expect(retrievedTerminal).toBeUndefined();
  });

  it('should remove a terminal correctly', () => {
    const terminal1 = TerminalRegistry.createTerminal();
    const terminal2 = TerminalRegistry.createTerminal();

    TerminalRegistry.removeTerminal(terminal1.id);
    const allTerminals = TerminalRegistry.getAllTerminals();

    expect(allTerminals).toHaveLength(1);
    expect(allTerminals[0]).toBe(terminal2);
  });

  it('should update a terminal correctly', () => {
    const terminal = TerminalRegistry.createTerminal();
    TerminalRegistry.updateTerminal(terminal.id, { busy: true, lastCommand: 'npm install' });

    const updatedTerminal = TerminalRegistry.getTerminal(terminal.id);
    expect(updatedTerminal).toHaveProperty('busy', true);
    expect(updatedTerminal).toHaveProperty('lastCommand', 'npm install');
  });

  it('getAllTerminals should exclude closed terminals', () => {
    const terminal1 = TerminalRegistry.createTerminal();
    const terminal2 = TerminalRegistry.createTerminal();

    // Simulate terminal1 being closed
    (terminal1.terminal as any).exitStatus = { code: 0 };

    const allTerminals = TerminalRegistry.getAllTerminals();

    expect(allTerminals).toHaveLength(1);
    expect(allTerminals[0]).toBe(terminal2);
  });

  it('getTerminal should remove and return undefined if terminal is closed', () => {
    const terminal = TerminalRegistry.createTerminal();

    // Simulate terminal being closed
    (terminal.terminal as any).exitStatus = { code: 0 };

    const retrievedTerminal = TerminalRegistry.getTerminal(terminal.id);

    expect(retrievedTerminal).toBeUndefined();
    expect(TerminalRegistry.getAllTerminals()).toHaveLength(0);
  });
});