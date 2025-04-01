// setupTerminalTests.ts
import { execSync } from "child_process"

/**
 * Check if PowerShell Core (pwsh) is available on the system
 */
function isPowerShellCoreAvailable() {
	try {
		execSync("pwsh -Command \"Write-Host 'PowerShell Core is available'\"", {
			stdio: "pipe",
		})
		return true
	} catch (error) {
		return false
	}
}

// Detect environment capabilities
const hasPwsh = isPowerShellCoreAvailable()

// Log environment information
console.log(`Test environment: ${process.platform} ${process.arch}`)
console.log(`PowerShell Core available: ${hasPwsh}`)

// Define interface for global test environment
declare global {
	namespace NodeJS {
		interface Global {
			__TEST_ENV__: {
				platform: string
				isPowerShellAvailable: boolean
			}
		}
	}
}

// Set global flags for tests to use
;(global as any).__TEST_ENV__ = {
	platform: process.platform,
	isPowerShellAvailable: hasPwsh,
}

// Dynamically enable/disable PowerShell tests based on availability
if (hasPwsh) {
	// If PowerShell is available, we could set an environment variable
	// that Jest can use to determine which tests to run
	process.env.PWSH_AVAILABLE = "true"

	// Note: Directly modifying Jest config at runtime is challenging
	// It's better to use environment variables and check them in your test files
	// or use Jest's condition-based skipping (it.skip, describe.skip)
}
