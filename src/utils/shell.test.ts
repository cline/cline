import { describe, it } from "mocha";
import "should";
import { getShell } from "./shell";
import * as vscode from "vscode";
import { userInfo } from "os";

describe("Shell Detection", () => {
  describe("Get shell using VS Code profiles, os, process, or fallback to /bin/sh", () => {
    let originalPlatform: string;
    let originalEnv: NodeJS.ProcessEnv;
    let originalGetConfig: any;
    let originalUserInfo: any;

    beforeEach(() => {
      originalPlatform = process.platform;
      originalEnv = { ...process.env };
      originalGetConfig = vscode.workspace.getConfiguration;
      originalUserInfo = userInfo;
      delete process.env.SHELL;
    });

    afterEach(() => {
      Object.defineProperty(process, "platform", {
        value: originalPlatform
      });
      process.env = originalEnv;
      vscode.workspace.getConfiguration = originalGetConfig;
      (userInfo as any) = originalUserInfo;
    });

    it("should handle Windows platform default", () => {
      Object.defineProperty(process, "platform", {
        value: "win32"
      });
      vscode.workspace.getConfiguration = () => ({
        get: () => undefined
      } as any);

      const shell = getShell();
      shell.should.equal("C:\\Windows\\System32\\cmd.exe");
    });

    it("should handle Windows PowerShell", () => {
      Object.defineProperty(process, "platform", {
        value: "win32"
      });
      vscode.workspace.getConfiguration = () => ({
        get: (key: string) => {
          if (key === "defaultProfile.windows") {
            return "PowerShell";
          }
          if (key === "profiles.windows") {
            return { PowerShell: { source: "PowerShell" } };
          }
          return undefined;
        }
      } as any);

      const shell = getShell();
      shell.should.equal("C:\\Program Files\\PowerShell\\7\\pwsh.exe");
    });

    it("should handle Windows WSL", () => {
      Object.defineProperty(process, "platform", {
        value: "win32"
      });
      vscode.workspace.getConfiguration = () => ({
        get: (key: string) => {
          if (key === "defaultProfile.windows") {
            return "WSL";
          }
          if (key === "profiles.windows") {
            return { WSL: { source: "WSL" } };
          }
          return undefined;
        }
      } as any);

      const shell = getShell();
      shell.should.equal("/bin/bash");
    });

    it("should handle Linux platform", () => {
      Object.defineProperty(process, "platform", {
        value: "linux"
      });
      (userInfo as any) = () => ({ shell: null });

      const shell = getShell();
      shell.should.equal("/bin/bash");
    });

    it("should handle Linux with custom shell in env", () => {
      Object.defineProperty(process, "platform", {
        value: "linux"
      });
      (userInfo as any) = () => ({ shell: null });
      process.env.SHELL = "/usr/bin/zsh";

      const shell = getShell();
      shell.should.equal("/usr/bin/zsh");
    });

    it("should handle macOS platform", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin"
      });
      (userInfo as any) = () => ({ shell: null });

      const shell = getShell();
      shell.should.equal("/bin/zsh");
    });

    it("should handle macOS with custom shell in env", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin"
      });
      (userInfo as any) = () => ({ shell: null });
      process.env.SHELL = "/usr/local/bin/fish";

      const shell = getShell();
      shell.should.equal("/usr/local/bin/fish");
    });

    it("should handle undefined platform", () => {
      Object.defineProperty(process, "platform", {
        value: undefined
      });
      (userInfo as any) = () => ({ shell: null });

      const shell = getShell();
      shell.should.equal("/bin/sh");
    });

    it("should handle user info shell when available", () => {
      Object.defineProperty(process, "platform", {
        value: "linux"
      });
      const customShell = "/opt/homebrew/bin/fish";
      (userInfo as any) = () => ({ shell: customShell });

      const shell = getShell();
      shell.should.equal(customShell);
    });
  });
});
