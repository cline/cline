import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import { expect } from "chai"
import * as actualFs from "fs"
import * as actualOs from "os"
import * as vscode from "vscode"

// bun loads real ESM, so the SUT's `import { userInfo } from "os"` binding is
// read-only and cannot be reassigned (the previous mocha test did
// `(userInfo as any) = ...`). Route `userInfo` through a mutable module-level
// delegate installed via mock.module, then swap the delegate per-test.
let userInfoImpl: typeof actualOs.userInfo = actualOs.userInfo
const userInfoDelegate = ((...args: unknown[]) =>
	(userInfoImpl as (...a: unknown[]) => unknown)(...args)) as typeof actualOs.userInfo
const osMockNamespace = { ...actualOs, userInfo: userInfoDelegate }
const osMock = () => ({ ...osMockNamespace, default: osMockNamespace })
mock.module("os", osMock)
mock.module("node:os", osMock)

// getShell() probes the filesystem for PowerShell 7 when no Windows terminal
// profile is configured. Route existsSync through a mutable delegate so tests
// control which PowerShell installs "exist" regardless of the host machine.
let existsSyncImpl: typeof actualFs.existsSync = actualFs.existsSync
const existsSyncDelegate = ((path: unknown) => existsSyncImpl(path as string)) as typeof actualFs.existsSync
const fsMockNamespace = { ...actualFs, existsSync: existsSyncDelegate }
const fsMock = () => ({ ...fsMockNamespace, default: fsMockNamespace })
mock.module("fs", fsMock)
mock.module("node:fs", fsMock)

import { getShell } from "@utils/shell"

describe("Shell Detection Tests", () => {
	let originalPlatform: string
	let originalEnv: NodeJS.ProcessEnv
	let originalGetConfig: typeof vscode.workspace.getConfiguration
	let originalUserInfo: typeof actualOs.userInfo
	let originalExistsSync: typeof actualFs.existsSync

	// Helper to mock VS Code configuration
	function mockVsCodeConfig(platformKey: string, defaultProfileName: string | null, profiles: Record<string, any>) {
		vscode.workspace.getConfiguration = () =>
			({
				get: (key: string) => {
					if (key === `defaultProfile.${platformKey}`) {
						return defaultProfileName
					}
					if (key === `profiles.${platformKey}`) {
						return profiles
					}
					return undefined
				},
			}) as any
	}

	beforeEach(() => {
		// Store original references
		originalPlatform = process.platform
		originalEnv = { ...process.env }
		originalGetConfig = vscode.workspace.getConfiguration
		originalUserInfo = userInfoImpl
		originalExistsSync = existsSyncImpl

		// Clear environment variables for a clean test
		delete process.env.SHELL
		delete process.env.COMSPEC

		// Default userInfo() mock
		userInfoImpl = (() => ({ shell: null })) as any
		// Default: PowerShell 7 is not installed, so the Windows default
		// resolves to legacy Windows PowerShell.
		existsSyncImpl = (() => false) as any
	})

	afterEach(() => {
		// Restore everything
		Object.defineProperty(process, "platform", { value: originalPlatform })
		process.env = originalEnv
		vscode.workspace.getConfiguration = originalGetConfig
		userInfoImpl = originalUserInfo
		existsSyncImpl = originalExistsSync
	})

	// --------------------------------------------------------------------------
	// Windows Shell Detection
	// --------------------------------------------------------------------------
	describe("Windows Shell Detection", () => {
		beforeEach(() => {
			Object.defineProperty(process, "platform", { value: "win32" })
		})

		it("uses explicit PowerShell 7 path from VS Code config (profile path)", () => {
			mockVsCodeConfig("windows", "PowerShell", {
				PowerShell: { path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" },
			})
			expect(getShell()).to.equal("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
		})

		it("uses PowerShell 7 path if source is 'PowerShell' but no explicit path", () => {
			mockVsCodeConfig("windows", "PowerShell", {
				PowerShell: { source: "PowerShell" },
			})
			expect(getShell()).to.equal("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
		})

		it("falls back to legacy PowerShell if profile includes 'powershell' but no path/source", () => {
			mockVsCodeConfig("windows", "PowerShell", {
				PowerShell: {},
			})
			expect(getShell()).to.equal("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
		})

		it("handles undefined shell profile gracefully", () => {
			mockVsCodeConfig("windows", "NonExistentProfile", {})
			expect(getShell()).to.equal("C:\\Windows\\System32\\cmd.exe")
		})

		it("uses WSL bash when profile indicates WSL source", () => {
			mockVsCodeConfig("windows", "WSL", {
				WSL: { source: "WSL" },
			})
			expect(getShell()).to.equal("C:\\Windows\\System32\\wsl.exe")
		})

		it("uses WSL bash when profile name includes 'wsl'", () => {
			mockVsCodeConfig("windows", "Ubuntu WSL", {
				"Ubuntu WSL": {},
			})
			expect(getShell()).to.equal("C:\\Windows\\System32\\wsl.exe")
		})

		it("defaults to cmd.exe if no special profile is matched", () => {
			mockVsCodeConfig("windows", "CommandPrompt", {
				CommandPrompt: {},
			})
			expect(getShell()).to.equal("C:\\Windows\\System32\\cmd.exe")
		})

		it("defaults to PowerShell 7 when no profile is configured and pwsh is installed", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			existsSyncImpl = (() => true) as any

			expect(getShell()).to.equal("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
		})

		it("defaults to legacy Windows PowerShell when no profile is configured and pwsh is absent", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			existsSyncImpl = (() => false) as any

			expect(getShell()).to.equal("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
		})

		it("ignores userInfo() and COMSPEC — VS Code's default terminal ignores them too", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			userInfoImpl = () => ({ shell: "C:\\Custom\\OtherShell.exe" }) as any
			process.env.COMSPEC = "D:\\CustomCmd\\cmd.exe"

			expect(getShell()).to.equal("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
		})
	})

	// --------------------------------------------------------------------------
	// macOS Shell Detection
	// --------------------------------------------------------------------------
	describe("macOS Shell Detection", () => {
		beforeEach(() => {
			Object.defineProperty(process, "platform", { value: "darwin" })
		})

		it("uses VS Code profile path if available", () => {
			mockVsCodeConfig("osx", "MyCustomShell", {
				MyCustomShell: { path: "/usr/local/bin/fish" },
			})
			expect(getShell()).to.equal("/usr/local/bin/fish")
		})

		it("falls back to userInfo().shell if no VS Code config is available", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			userInfoImpl = () => ({ shell: "/opt/homebrew/bin/zsh" }) as any

			expect(getShell()).to.equal("/opt/homebrew/bin/zsh")
		})

		it("falls back to SHELL env var if no userInfo shell is found", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			process.env.SHELL = "/usr/local/bin/zsh"

			expect(getShell()).to.equal("/usr/local/bin/zsh")
		})

		it("falls back to /bin/zsh if no config, userInfo, or env variable is set", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			// userInfo => null, SHELL => undefined
			expect(getShell()).to.equal("/bin/zsh")
		})
	})

	// --------------------------------------------------------------------------
	// Linux Shell Detection
	// --------------------------------------------------------------------------
	describe("Linux Shell Detection", () => {
		beforeEach(() => {
			Object.defineProperty(process, "platform", { value: "linux" })
		})

		it("uses VS Code profile path if available", () => {
			mockVsCodeConfig("linux", "CustomProfile", {
				CustomProfile: { path: "/usr/bin/fish" },
			})
			expect(getShell()).to.equal("/usr/bin/fish")
		})

		it("falls back to userInfo().shell if no VS Code config is available", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			userInfoImpl = () => ({ shell: "/usr/bin/zsh" }) as any

			expect(getShell()).to.equal("/usr/bin/zsh")
		})

		it("falls back to SHELL env var if no userInfo shell is found", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			process.env.SHELL = "/usr/bin/fish"

			expect(getShell()).to.equal("/usr/bin/fish")
		})

		it("falls back to /bin/bash if nothing is set", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			// userInfo => null, SHELL => undefined
			expect(getShell()).to.equal("/bin/bash")
		})
	})

	// --------------------------------------------------------------------------
	// Unknown Platform & Error Handling
	// --------------------------------------------------------------------------
	describe("Unknown Platform / Error Handling", () => {
		it("falls back to /bin/sh for unknown platforms", () => {
			Object.defineProperty(process, "platform", { value: "sunos" })
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any

			expect(getShell()).to.equal("/bin/sh")
		})

		it("handles VS Code config errors gracefully, falling back to userInfo shell if present", () => {
			Object.defineProperty(process, "platform", { value: "linux" })
			vscode.workspace.getConfiguration = () => {
				throw new Error("Configuration error")
			}
			userInfoImpl = () => ({ shell: "/bin/bash" }) as any

			expect(getShell()).to.equal("/bin/bash")
		})

		it("handles userInfo errors gracefully, falling back to environment variable if present", () => {
			Object.defineProperty(process, "platform", { value: "darwin" })
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			userInfoImpl = () => {
				throw new Error("userInfo error")
			}
			process.env.SHELL = "/bin/zsh"

			expect(getShell()).to.equal("/bin/zsh")
		})

		it("falls back fully to default shell paths if everything fails", () => {
			Object.defineProperty(process, "platform", { value: "linux" })
			vscode.workspace.getConfiguration = () => {
				throw new Error("Configuration error")
			}
			userInfoImpl = () => {
				throw new Error("userInfo error")
			}
			// No SHELL in env
			delete process.env.SHELL

			expect(getShell()).to.equal("/bin/bash")
		})
	})
})
