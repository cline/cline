// TerminalRegistry.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TerminalRegistry, TerminalInfo } from './TerminalRegistry';
import { vscode } from '../../../tests/vscode-mocks'; // 引入模擬的 VSCode 模組

describe('TerminalRegistry', () => {
  beforeEach(() => {
    // 重置 TerminalRegistry 的內部狀態
    (TerminalRegistry as any).terminals = [];
    (TerminalRegistry as any).nextTerminalId = 1;
    console.log('Before each test: Resetting TerminalRegistry state');
  });

  describe('createTerminal', () => {
    it('應該以正確的默認屬性創建終端', () => {
      console.log('Test: 應該以正確的默認屬性創建終端');
      const terminalInfo = TerminalRegistry.createTerminal();
      console.log('Created TerminalInfo:', terminalInfo);

      expect(terminalInfo).toHaveProperty('id', 1);
      expect(terminalInfo).toHaveProperty('busy', false);
      expect(terminalInfo).toHaveProperty('lastCommand', '');
      expect(terminalInfo.terminal).toBeDefined();
      expect(vscode.window.createTerminal).toHaveBeenCalledWith({
        cwd: undefined,
        name: 'Cline',
        iconPath: expect.any(vscode.ThemeIcon),
      });
    });

    it('應該以遞增的 ID 創建多個終端', () => {
      console.log('Test: 應該以遞增的 ID 創建多個終端');
      const terminal1 = TerminalRegistry.createTerminal();
      const terminal2 = TerminalRegistry.createTerminal();
      console.log('Created Terminal 1:', terminal1);
      console.log('Created Terminal 2:', terminal2);

      expect(terminal1.id).toBe(1);
      expect(terminal2.id).toBe(2);
    });

    it('應該以指定的工作目錄創建終端', () => {
      console.log('Test: 應該以指定的工作目錄創建終端');
      const cwd = '/test/path';
      const terminalInfo = TerminalRegistry.createTerminal(cwd);
      console.log('Created TerminalInfo with cwd:', terminalInfo);

      expect(vscode.window.createTerminal).toHaveBeenCalledWith({
        cwd,
        name: 'Cline',
        iconPath: expect.any(vscode.ThemeIcon),
      });
    });
  });

  describe('getTerminal', () => {
    it('應該通過 ID 獲取已存在的終端', () => {
      console.log('Test: 應該通過 ID 獲取已存在的終端');
      const originalTerminal = TerminalRegistry.createTerminal();
      console.log('Created Terminal:', originalTerminal);
      const retrievedTerminal = TerminalRegistry.getTerminal(originalTerminal.id);
      console.log('Retrieved Terminal:', retrievedTerminal);

      expect(retrievedTerminal).toBe(originalTerminal);
    });

    it('應該對不存在的終端 ID 返回 undefined', () => {
      console.log('Test: 應該對不存在的終端 ID 返回 undefined');
      const retrievedTerminal = TerminalRegistry.getTerminal(999);
      console.log('Retrieved Terminal:', retrievedTerminal);

      expect(retrievedTerminal).toBeUndefined();
    });

    it('應該移除並對已關閉的終端返回 undefined', () => {
      console.log('Test: 應該移除並對已關閉的終端返回 undefined');
      const terminal = TerminalRegistry.createTerminal();
      console.log('Created Terminal:', terminal);

      // 模擬終端關閉
      console.log('Setting exitStatus to simulate terminal closure');
      terminal.terminal.exitStatus = { code: 0, reason: vscode.TerminalExitReason.ShellExit };
      console.log('Simulated terminal closure:', terminal);

      const retrievedTerminal = TerminalRegistry.getTerminal(terminal.id);
      console.log('Retrieved Terminal after closure:', retrievedTerminal);

      expect(retrievedTerminal).toBeUndefined();
      expect(TerminalRegistry.getTerminal(terminal.id)).toBeUndefined();
    });
  });

  describe('removeTerminal', () => {
    it('應該通過 ID 移除指定的終端', () => {
      console.log('Test: 應該通過 ID 移除指定的終端');
      const terminal1 = TerminalRegistry.createTerminal();
      const terminal2 = TerminalRegistry.createTerminal();
      console.log('Created Terminal 1:', terminal1);
      console.log('Created Terminal 2:', terminal2);

      TerminalRegistry.removeTerminal(terminal1.id);
      console.log('Removed Terminal 1:', terminal1);

      const remainingTerminals = (TerminalRegistry as any).terminals;
      console.log('Remaining Terminals:', remainingTerminals);

      expect(remainingTerminals).toHaveLength(1);
      expect(remainingTerminals[0]).toBe(terminal2);
    });
  });

  describe('updateTerminal', () => {
    it('應該更新終端的屬性', () => {
      console.log('Test: 應該更新終端的屬性');
      const terminal = TerminalRegistry.createTerminal();
      console.log('Created Terminal:', terminal);

      TerminalRegistry.updateTerminal(terminal.id, {
        busy: true,
        lastCommand: 'test command',
      });
      console.log('Updated Terminal:', terminal);

      const updatedTerminal = TerminalRegistry.getTerminal(terminal.id);
      console.log('Retrieved Updated Terminal:', updatedTerminal);

      expect(updatedTerminal).toHaveProperty('busy', true);
      expect(updatedTerminal).toHaveProperty('lastCommand', 'test command');
    });

    it('應該不會更新不存在的終端', () => {
      console.log('Test: 應該不會更新不存在的終端');
      TerminalRegistry.updateTerminal(999, {
        busy: true,
        lastCommand: 'test command',
      });
      console.log('Attempted to update non-existent terminal');

      // 確保沒有任何終端被更新
      const allTerminals = TerminalRegistry.getAllTerminals();
      expect(allTerminals).toHaveLength(0);
    });
  });

  describe('getAllTerminals', () => {
    it('應該返回所有活躍的終端', () => {
      console.log('Test: 應該返回所有活躍的終端');
      const terminal1 = TerminalRegistry.createTerminal();
      const terminal2 = TerminalRegistry.createTerminal();
      console.log('Created Terminal 1:', terminal1);
      console.log('Created Terminal 2:', terminal2);

      // 模擬第一個終端已關閉
      terminal1.terminal.exitStatus = { code: 0, reason: vscode.TerminalExitReason.ShellExit };
      console.log('Simulated terminal1 closure:', terminal1);

      const activeTerminals = TerminalRegistry.getAllTerminals();
      console.log('Active Terminals:', activeTerminals);

      expect(activeTerminals).toHaveLength(1);
      expect(activeTerminals[0]).toBe(terminal2);
    });

    it('應該只返回尚未關閉的終端', () => {
      console.log('Test: 應該只返回尚未關閉的終端');
      const terminal1 = TerminalRegistry.createTerminal();
      const terminal2 = TerminalRegistry.createTerminal();
      console.log('Created Terminal 1:', terminal1);
      console.log('Created Terminal 2:', terminal2);

      // 模擬兩個終端都已關閉
      terminal1.terminal.exitStatus = { code: 0, reason: vscode.TerminalExitReason.ShellExit };
      terminal2.terminal.exitStatus = { code: 1, reason: vscode.TerminalExitReason.ShellExit };
      console.log('Simulated terminal closures:', terminal1, terminal2);

      const activeTerminals = TerminalRegistry.getAllTerminals();
      console.log('Active Terminals:', activeTerminals);

      expect(activeTerminals).toHaveLength(0);
    });

    it('應該返回空陣列當沒有活躍終端時', () => {
      console.log('Test: 應該返回空陣列當沒有活躍終端時');
      const activeTerminals = TerminalRegistry.getAllTerminals();
      console.log('Active Terminals:', activeTerminals);

      expect(activeTerminals).toHaveLength(0);
    });
  });
});