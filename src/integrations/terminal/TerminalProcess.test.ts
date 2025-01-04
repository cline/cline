import { describe, it, expect, beforeEach } from "vitest";
import { TerminalProcess } from "./TerminalProcess";
import { vscode } from "../../../tests/vscode-mocks";

describe("TerminalProcess", () => {
  let terminalProcess: TerminalProcess;

  beforeEach(() => {
    terminalProcess = new TerminalProcess();
  });

  describe("Method Existence", () => {
    it("should have run method", () => {
      expect(terminalProcess.run).toBeDefined();
      expect(typeof terminalProcess.run).toBe("function");
    });

    it("should have continue method", () => {
      expect(terminalProcess.continue).toBeDefined();
      expect(typeof terminalProcess.continue).toBe("function");
    });

    it("should have getUnretrievedOutput method", () => {
      expect(terminalProcess.getUnretrievedOutput).toBeDefined();
      expect(typeof terminalProcess.getUnretrievedOutput).toBe("function");
    });
  });

  describe("Command Execution", () => {
    it("should execute command with shell integration", async () => {
      const terminal = vscode.window.createTerminal();
      const mockExecution = {
        exitCode: Promise.resolve(0),
        read: () => ({
          [Symbol.asyncIterator]: async function* () {
            yield "Command output line 1";
            yield "Command output line 2";
          }
        })
      };

      (terminal as any).shellIntegration = {
        executeCommand: () => mockExecution
      };

      const command = "echo 'test'";
      const processPromise = terminalProcess.run(terminal, command);

      // Wait for command to complete
      await processPromise;

      // Check output
      const output = terminalProcess.getUnretrievedOutput();
      expect(output).toContain("Command output line 1");
      expect(output).toContain("Command output line 2");
    });

    it("should handle command execution without shell integration", async () => {
      const terminal = vscode.window.createTerminal();
      const command = "echo 'test'";

      const processPromise = terminalProcess.run(terminal, command);

      // Verify terminal.sendText was called
      expect(terminal.sendText).toHaveBeenCalledWith(command);

      // Wait for command to complete
      await processPromise;
    });
  });

  describe("Event Handling", () => {
    it("should emit line events", async () => {
      const terminal = vscode.window.createTerminal();
      const mockExecution = {
        exitCode: Promise.resolve(0),
        read: () => ({
          [Symbol.asyncIterator]: async function* () {
            yield "Test line";
          }
        })
      };

      (terminal as any).shellIntegration = {
        executeCommand: () => mockExecution
      };

      const lineHandler = vi.fn();
      terminalProcess.on("line", lineHandler);

      await terminalProcess.run(terminal, "test");

      expect(lineHandler).toHaveBeenCalledWith("Test line");
    });

    it("should emit completed event", async () => {
      const terminal = vscode.window.createTerminal();
      const completedHandler = vi.fn();
      terminalProcess.on("completed", completedHandler);

      await terminalProcess.run(terminal, "test");

      expect(completedHandler).toHaveBeenCalled();
    });
  });
});
