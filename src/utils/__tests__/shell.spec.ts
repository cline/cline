import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { userInfo } from "os"
import { getShell } from "../shell"

// Mock vscode module
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(),
	},
}))

// Mock the os module
vi.mock("os", () => ({
	userInfo: vi.fn(() => ({ shell: null })),
}))

// Mock path module for testing
vi.mock("path", async () => {
	const actual = await vi.importActual("path")
	return {
		...actual,
		normalize: vi.fn((p: string) => p),
	}
})

describe("Shell Detection Tests", () => {
	let originalPlatform: string
	let originalEnv: NodeJS.ProcessEnv
	let originalGetConfig: any

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

		// Clear environment variables for a clean test
		delete process.env.SHELL
		delete process.env.COMSPEC

		// Reset userInfo mock to default
		vi.mocked(userInfo).mockReturnValue({ shell: null } as any)
	})

	afterEach(() => {
		// Restore everything
		Object.defineProperty(process, "platform", { value: originalPlatform })
		process.env = originalEnv
		vscode.workspace.getConfiguration = originalGetConfig
		vi.clearAllMocks()
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
			expect(getShell()).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
		})

		it("should handle array path from VSCode terminal profile", () => {
			// Mock VSCode configuration with array path
			const mockConfig = {
				get: vi.fn((key: string) => {
					if (key === "defaultProfile.windows") return "PowerShell"
					if (key === "profiles.windows") {
						return {
							PowerShell: {
								// VSCode API may return path as an array
								path: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "pwsh.exe"],
							},
						}
					}
					return undefined
				}),
			}

			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

			const result = getShell()
			// Should use the first element of the array
			expect(result).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
		})

		it("should handle empty array path and fall back to defaults", () => {
			// Mock VSCode configuration with empty array path
			const mockConfig = {
				get: vi.fn((key: string) => {
					if (key === "defaultProfile.windows") return "Custom"
					if (key === "profiles.windows") {
						return {
							Custom: {
								path: [], // Empty array
							},
						}
					}
					return undefined
				}),
			}

			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

			// Mock environment variable
			process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe"

			const result = getShell()
			// Should fall back to cmd.exe
			expect(result).toBe("C:\\Windows\\System32\\cmd.exe")
		})

		it("uses PowerShell 7 path if source is 'PowerShell' but no explicit path", () => {
			mockVsCodeConfig("windows", "PowerShell", {
				PowerShell: { source: "PowerShell" },
			})
			expect(getShell()).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
		})

		it("falls back to legacy PowerShell if profile includes 'powershell' but no path/source", () => {
			mockVsCodeConfig("windows", "PowerShell", {
				PowerShell: {},
			})
			expect(getShell()).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
		})

		it("uses WSL bash when profile indicates WSL source", () => {
			mockVsCodeConfig("windows", "WSL", {
				WSL: { source: "WSL" },
			})
			expect(getShell()).toBe("/bin/bash")
		})

		it("uses WSL bash when profile name includes 'wsl'", () => {
			mockVsCodeConfig("windows", "Ubuntu WSL", {
				"Ubuntu WSL": {},
			})
			expect(getShell()).toBe("/bin/bash")
		})

		it("defaults to cmd.exe if no special profile is matched", () => {
			mockVsCodeConfig("windows", "CommandPrompt", {
				CommandPrompt: {},
			})
			expect(getShell()).toBe("C:\\Windows\\System32\\cmd.exe")
		})

		it("handles undefined profile gracefully", () => {
			// Mock a case where defaultProfileName exists but the profile doesn't
			mockVsCodeConfig("windows", "NonexistentProfile", {})
			expect(getShell()).toBe("C:\\Windows\\System32\\cmd.exe")
		})

		it("respects userInfo() if no VS Code config is available and shell is allowed", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			vi.mocked(userInfo).mockReturnValue({ shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" } as any)

			expect(getShell()).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
		})

		it("falls back to safe shell when userInfo() returns non-allowlisted shell", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			vi.mocked(userInfo).mockReturnValue({ shell: "C:\\Custom\\PowerShell.exe" } as any)

			expect(getShell()).toBe("C:\\Windows\\System32\\cmd.exe")
		})

		it("falls back to safe shell when COMSPEC is non-allowlisted", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			process.env.COMSPEC = "D:\\CustomCmd\\cmd.exe"

			expect(getShell()).toBe("C:\\Windows\\System32\\cmd.exe")
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
			expect(getShell()).toBe("/usr/local/bin/fish")
		})

		it("should handle array path from VSCode terminal profile", () => {
			// Mock VSCode configuration with array path
			const mockConfig = {
				get: vi.fn((key: string) => {
					if (key === "defaultProfile.osx") return "zsh"
					if (key === "profiles.osx") {
						return {
							zsh: {
								path: ["/opt/homebrew/bin/zsh", "/bin/zsh"],
							},
						}
					}
					return undefined
				}),
			}

			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

			const result = getShell()
			// Should use the first element of the array
			expect(result).toBe("/opt/homebrew/bin/zsh")
		})

		it("falls back to userInfo().shell if no VS Code config is available", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			vi.mocked(userInfo).mockReturnValue({ shell: "/opt/homebrew/bin/zsh" } as any)
			expect(getShell()).toBe("/opt/homebrew/bin/zsh")
		})

		it("falls back to SHELL env var if no userInfo shell is found", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			process.env.SHELL = "/usr/local/bin/zsh"
			expect(getShell()).toBe("/usr/local/bin/zsh")
		})

		it("falls back to /bin/zsh if no config, userInfo, or env variable is set", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			expect(getShell()).toBe("/bin/zsh")
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
			expect(getShell()).toBe("/usr/bin/fish")
		})

		it("should handle array path from VSCode terminal profile", () => {
			// Mock VSCode configuration with array path
			const mockConfig = {
				get: vi.fn((key: string) => {
					if (key === "defaultProfile.linux") return "bash"
					if (key === "profiles.linux") {
						return {
							bash: {
								path: ["/usr/local/bin/bash", "/bin/bash"],
							},
						}
					}
					return undefined
				}),
			}

			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

			const result = getShell()
			// Should use the first element of the array
			expect(result).toBe("/usr/local/bin/bash")
		})

		it("falls back to userInfo().shell if no VS Code config is available", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			vi.mocked(userInfo).mockReturnValue({ shell: "/usr/bin/zsh" } as any)
			expect(getShell()).toBe("/usr/bin/zsh")
		})

		it("falls back to SHELL env var if no userInfo shell is found", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			process.env.SHELL = "/usr/bin/fish"
			expect(getShell()).toBe("/usr/bin/fish")
		})

		it("falls back to /bin/bash if nothing is set", () => {
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			expect(getShell()).toBe("/bin/bash")
		})
	})

	// --------------------------------------------------------------------------
	// Unknown Platform & Error Handling
	// --------------------------------------------------------------------------
	describe("Unknown Platform / Error Handling", () => {
		it("falls back to /bin/bash for unknown platforms", () => {
			Object.defineProperty(process, "platform", { value: "sunos" })
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			expect(getShell()).toBe("/bin/bash")
		})

		it("handles VS Code config errors gracefully, falling back to userInfo shell if present", () => {
			Object.defineProperty(process, "platform", { value: "linux" })
			vscode.workspace.getConfiguration = () => {
				throw new Error("Configuration error")
			}
			vi.mocked(userInfo).mockReturnValue({ shell: "/bin/bash" } as any)
			expect(getShell()).toBe("/bin/bash")
		})

		it("handles userInfo errors gracefully, falling back to environment variable if present", () => {
			Object.defineProperty(process, "platform", { value: "darwin" })
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			vi.mocked(userInfo).mockImplementation(() => {
				throw new Error("userInfo error")
			})
			process.env.SHELL = "/bin/zsh"
			expect(getShell()).toBe("/bin/zsh")
		})

		it("falls back fully to default shell paths if everything fails", () => {
			Object.defineProperty(process, "platform", { value: "linux" })
			vscode.workspace.getConfiguration = () => {
				throw new Error("Configuration error")
			}
			vi.mocked(userInfo).mockImplementation(() => {
				throw new Error("userInfo error")
			})
			delete process.env.SHELL
			expect(getShell()).toBe("/bin/bash")
		})
	})

	// --------------------------------------------------------------------------
	// Shell Validation Tests
	// --------------------------------------------------------------------------
	describe("Shell Validation", () => {
		it("should allow common Windows shells", () => {
			Object.defineProperty(process, "platform", { value: "win32" })
			mockVsCodeConfig("windows", "PowerShell", {
				PowerShell: { path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" },
			})
			expect(getShell()).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
		})

		it("should allow common Unix shells", () => {
			Object.defineProperty(process, "platform", { value: "linux" })
			mockVsCodeConfig("linux", "CustomProfile", {
				CustomProfile: { path: "/usr/bin/fish" },
			})
			expect(getShell()).toBe("/usr/bin/fish")
		})

		it("should handle case-insensitive matching on Windows", () => {
			Object.defineProperty(process, "platform", { value: "win32" })
			mockVsCodeConfig("windows", "PowerShell", {
				PowerShell: { path: "c:\\windows\\system32\\cmd.exe" },
			})
			expect(getShell()).toBe("c:\\windows\\system32\\cmd.exe")
		})

		it("should reject unknown shells and use fallback", () => {
			Object.defineProperty(process, "platform", { value: "linux" })
			mockVsCodeConfig("linux", "CustomProfile", {
				CustomProfile: { path: "/usr/bin/malicious-shell" },
			})
			expect(getShell()).toBe("/bin/bash")
		})

		it("should validate array shell paths and use first allowed", () => {
			Object.defineProperty(process, "platform", { value: "win32" })

			const mockConfig = {
				get: vi.fn((key: string) => {
					if (key === "defaultProfile.windows") return "PowerShell"
					if (key === "profiles.windows") {
						return {
							PowerShell: {
								path: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "pwsh"],
							},
						}
					}
					return undefined
				}),
			}

			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

			const result = getShell()
			// Should return the first allowed shell from the array
			expect(result).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
		})

		it("should reject non-allowed shell paths and fall back to safe defaults", () => {
			Object.defineProperty(process, "platform", { value: "win32" })

			const mockConfig = {
				get: vi.fn((key: string) => {
					if (key === "defaultProfile.windows") return "Malicious"
					if (key === "profiles.windows") {
						return {
							Malicious: {
								path: "C:\\malicious\\shell.exe",
							},
						}
					}
					return undefined
				}),
			}

			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

			// Mock environment to provide a fallback
			process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe"

			const result = getShell()
			// Should fall back to safe default (cmd.exe)
			expect(result).toBe("C:\\Windows\\System32\\cmd.exe")
		})

		it("should validate shells from VS Code config", () => {
			Object.defineProperty(process, "platform", { value: "darwin" })
			mockVsCodeConfig("osx", "MyCustomShell", {
				MyCustomShell: { path: "/usr/local/bin/custom-shell" },
			})

			const result = getShell()
			expect(result).toBe("/bin/zsh") // macOS fallback
		})

		it("should validate shells from userInfo", () => {
			Object.defineProperty(process, "platform", { value: "linux" })
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			vi.mocked(userInfo).mockReturnValue({ shell: "/usr/bin/evil-shell" } as any)

			const result = getShell()
			expect(result).toBe("/bin/bash") // Linux fallback
		})

		it("should validate shells from environment variables", () => {
			Object.defineProperty(process, "platform", { value: "linux" })
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			vi.mocked(userInfo).mockReturnValue({ shell: null } as any)
			process.env.SHELL = "/opt/custom/shell"

			const result = getShell()
			expect(result).toBe("/bin/bash") // Linux fallback
		})

		it("should handle WSL bash correctly", () => {
			Object.defineProperty(process, "platform", { value: "win32" })
			mockVsCodeConfig("windows", "WSL", {
				WSL: { source: "WSL" },
			})

			const result = getShell()
			expect(result).toBe("/bin/bash") // Should be allowed
		})

		it("should handle empty or null shell paths", () => {
			Object.defineProperty(process, "platform", { value: "linux" })
			vscode.workspace.getConfiguration = () => ({ get: () => undefined }) as any
			vi.mocked(userInfo).mockReturnValue({ shell: "" } as any)
			delete process.env.SHELL

			const result = getShell()
			expect(result).toBe("/bin/bash") // Should fall back to safe default
		})
	})
})
