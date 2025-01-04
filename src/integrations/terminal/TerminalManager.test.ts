// TerminalManager.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vscode } from '../../../tests/vscode-mocks';
import { TerminalManager } from './TerminalManager';
import { TerminalRegistry, TerminalInfo } from './TerminalRegistry';
import { waitForNextTick } from '../../../tests/setup';

describe('TerminalManager', () => {
  let terminalManager: TerminalManager;
  let mockTerminalInfo: TerminalInfo;
  
  beforeEach(() => {
    terminalManager = new TerminalManager();
    mockTerminalInfo = TerminalRegistry.createTerminal('/test/path');
  });

  afterEach(() => {
    terminalManager.disposeAll();
    vi.resetAllMocks();
    const allTerminals = TerminalRegistry.getAllTerminals();
    allTerminals.forEach(t => TerminalRegistry.removeTerminal(t.id));
  });

  describe('Terminal Creation', () => {
    it('should create a terminal with correct configuration', () => {
      expect(vscode.window.createTerminal).toHaveBeenCalledWith({
        cwd: '/test/path',
        name: 'Cline',
        iconPath: expect.anything(),
      });
      
      expect(mockTerminalInfo).toMatchObject({
        busy: false,
        lastCommand: '',
        id: expect.any(Number),
      });
    });

    it('should handle terminal creation failure gracefully', () => {
      vi.spyOn(vscode.window, 'createTerminal').mockImplementationOnce(() => {
        throw new Error('Terminal creation failed');
      });

      expect(() => TerminalRegistry.createTerminal('/test/path'))
        .toThrow('Terminal creation failed');
    });
  });

  describe('Command Execution', () => {
    it('should execute commands and update terminal state', async () => {
      const command = 'echo "test"';
      const processPromise = terminalManager.runCommand(mockTerminalInfo, command);

      expect(mockTerminalInfo.busy).toBe(true);
      expect(mockTerminalInfo.lastCommand).toBe(command);

      await processPromise;
      await waitForNextTick();

      expect(mockTerminalInfo.busy).toBe(false);
    });

    it('should handle command execution errors', async () => {
      const command = 'invalid-command';
      vi.spyOn(vscode.window, 'showErrorMessage');

      const processPromise = terminalManager.runCommand(mockTerminalInfo, command);
      await expect(processPromise).rejects.toThrow();
      
      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
      expect(mockTerminalInfo.busy).toBe(false);
    });
  });

  describe('Terminal Lifecycle', () => {
    it('should handle terminal disposal', () => {
      const terminal = vscode.window.terminals[0];
      terminalManager.disposeAll();

      expect(terminal.dispose).toHaveBeenCalled();
      expect(TerminalRegistry.getAllTerminals()).toHaveLength(0);
    });

    it('should update registry when terminal closes', () => {
      const closeHandler = vi.fn();
      terminalManager.onTerminalClosed(closeHandler);

      // Simulate terminal close
      const terminal = vscode.window.terminals[0];
      terminal.dispose();

      expect(closeHandler).toHaveBeenCalledWith(mockTerminalInfo.id);
      expect(TerminalRegistry.getAllTerminals()).toHaveLength(0);
    });
  });
});