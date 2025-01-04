import { describe, it, expect, vi } from "vitest";
import { TerminalManager } from "./TerminalManager";
import { TerminalInfo, TerminalRegistry } from "./TerminalRegistry";
import * as vscode from "vscode";
import { TerminalProcess } from "./TerminalProcess";

describe("TerminalManager", () => {
  let terminalManager: TerminalManager;
  let mockTerminal: vscode.Terminal;
  let mockTerminalInfo: TerminalInfo;

  beforeEach(() => {
    vi.resetAllMocks();

    mockTerminal = {
      shellIntegration: {
        executeCommand: vi.fn(),
        cwd: vscode.Uri.file("/path/to/project"),
      },
      sendText: vi.fn(),
    } as unknown as vscode.Terminal;

    mockTerminalInfo = {
      terminal: mockTerminal,
      busy: false,
      lastCommand: "",
      id: 1,
    };

    vi.mock("./TerminalRegistry", () => ({
      TerminalRegistry: {
        createTerminal: vi.fn().mockReturnValue(mockTerminalInfo),
        getAllTerminals: vi.fn().mockReturnValue([mockTerminalInfo]),
        getTerminal: vi.fn().mockReturnValue(mockTerminalInfo),
        removeTerminal: vi.fn(),
      },
    }));

    terminalManager = new TerminalManager();
  });

  it("should create a new TerminalManager instance", () => {
    expect(terminalManager).toBeInstanceOf(TerminalManager);
  });

  describe("runCommand", () => {
    it("should run a command in an existing terminal", async () => {
      const command = "npm install";
      const cwd = "/path/to/project";
      const terminalInfo = await terminalManager.getOrCreateTerminal(cwd);
      const process = terminalManager.runCommand(terminalInfo, command);

      expect(mockTerminal.shellIntegration?.executeCommand).toHaveBeenCalledWith(command);
      expect(process).toBeInstanceOf(TerminalProcess);
    });

    it("should run a command in a new terminal if no existing terminal is available", async () => {
      const command = "npm install";
      const cwd = "/path/to/project";
      (TerminalRegistry.getAllTerminals as any).mockReturnValue([]);

      const process = await terminalManager.runCommand({ terminal: mockTerminal, busy: false, lastCommand: "", id: 1 }, command);

      expect(TerminalRegistry.createTerminal).toHaveBeenCalledWith(cwd);
      expect(mockTerminal.shellIntegration?.executeCommand).toHaveBeenCalledWith(command);
      expect(process).toBeInstanceOf(TerminalProcess);
    });

    it("should handle terminals without shell integration", async () => {
      const command = "npm install";
      const cwd = "/path/to/project";
      mockTerminal = {
        ...mockTerminal,
        shellIntegration: undefined,
      } as unknown as vscode.Terminal;

      const process = await terminalManager.runCommand({ terminal: mockTerminal, busy: false, lastCommand: "", id: 1 }, command);

      expect(mockTerminal.sendText).toHaveBeenCalledWith(command, true);
      expect(process).toBeInstanceOf(TerminalProcess);
    });
  });

  describe("getOrCreateTerminal", () => {
    it("should return an existing terminal if available", async () => {
      const cwd = "/path/to/project";
      const terminalInfo = await terminalManager.getOrCreateTerminal(cwd);

      expect(terminalInfo).toBe(mockTerminalInfo);
      expect(TerminalRegistry.createTerminal).not.toHaveBeenCalled();
    });

    it("should create a new terminal if no existing terminal is available", async () => {
      const cwd = "/path/to/project";
      (TerminalRegistry.getAllTerminals as any).mockReturnValue([]);

      const terminalInfo = await terminalManager.getOrCreateTerminal(cwd);

      expect(terminalInfo).toBe(mockTerminalInfo);
      expect(TerminalRegistry.createTerminal).toHaveBeenCalledWith(cwd);
    });
  });

  describe("getTerminals", () => {
    it("should return terminals based on the busy status", () => {
      const busyTerminals = terminalManager.getTerminals(true);
      const idleTerminals = terminalManager.getTerminals(false);

      expect(busyTerminals).toEqual([]);
      expect(idleTerminals.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("disposeAll", () => {
    it("should dispose all resources", () => {
      terminalManager.disposeAll();

      expect(terminalManager["disposables"].length).toBe(0);
    });
  });
});
