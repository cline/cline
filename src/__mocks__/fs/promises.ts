// Mock file system data
const mockFiles = new Map()
const mockDirectories = new Set()

// Initialize base test directories
const baseTestDirs = [
	"/mock",
	"/mock/extension",
	"/mock/extension/path",
	"/mock/storage",
	"/mock/storage/path",
	"/mock/settings",
	"/mock/settings/path",
	"/mock/mcp",
	"/mock/mcp/path",
	"/test",
	"/test/path",
	"/test/storage",
	"/test/storage/path",
	"/test/storage/path/settings",
	"/test/extension",
	"/test/extension/path",
	"/test/global-storage",
	"/test/log/path",
]

type RuleFiles = {
	".clinerules-code": string
	".clinerules-ask": string
	".clinerules-architect": string
	".clinerules-test": string
	".clinerules-review": string
	".clinerules": string
}

// Helper function to ensure directory exists
const ensureDirectoryExists = (path: string) => {
	const parts = path.split("/")
	let currentPath = ""
	for (const part of parts) {
		if (!part) continue
		currentPath += "/" + part
		mockDirectories.add(currentPath)
	}
}

const mockFs = {
	readFile: jest.fn().mockImplementation(async (filePath: string, _encoding?: string) => {
		// Return stored content if it exists
		if (mockFiles.has(filePath)) {
			return mockFiles.get(filePath)
		}

		// Handle rule files
		const ruleFiles: RuleFiles = {
			".clinerules-code": "# Code Mode Rules\n1. Code specific rule",
			".clinerules-ask": "# Ask Mode Rules\n1. Ask specific rule",
			".clinerules-architect": "# Architect Mode Rules\n1. Architect specific rule",
			".clinerules-test":
				"# Test Engineer Rules\n1. Always write tests first\n2. Get approval before modifying non-test code",
			".clinerules-review":
				"# Code Reviewer Rules\n1. Provide specific examples in feedback\n2. Focus on maintainability and best practices",
			".clinerules": "# Test Rules\n1. First rule\n2. Second rule",
		}

		// Check for exact file name match
		const fileName = filePath.split("/").pop()
		if (fileName && fileName in ruleFiles) {
			return ruleFiles[fileName as keyof RuleFiles]
		}

		// Check for file name in path
		for (const [ruleFile, content] of Object.entries(ruleFiles)) {
			if (filePath.includes(ruleFile)) {
				return content
			}
		}

		// Handle file not found
		const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`)
		;(error as any).code = "ENOENT"
		throw error
	}),

	writeFile: jest.fn().mockImplementation(async (path: string, content: string) => {
		// Ensure parent directory exists
		const parentDir = path.split("/").slice(0, -1).join("/")
		ensureDirectoryExists(parentDir)
		mockFiles.set(path, content)
		return Promise.resolve()
	}),

	mkdir: jest.fn().mockImplementation(async (path: string, options?: { recursive?: boolean }) => {
		// Always handle recursive creation
		const parts = path.split("/")
		let currentPath = ""

		// For recursive or test/mock paths, create all parent directories
		if (options?.recursive || path.startsWith("/test") || path.startsWith("/mock")) {
			for (const part of parts) {
				if (!part) continue
				currentPath += "/" + part
				mockDirectories.add(currentPath)
			}
			return Promise.resolve()
		}

		// For non-recursive paths, verify parent exists
		for (let i = 0; i < parts.length - 1; i++) {
			if (!parts[i]) continue
			currentPath += "/" + parts[i]
			if (!mockDirectories.has(currentPath)) {
				const error = new Error(`ENOENT: no such file or directory, mkdir '${path}'`)
				;(error as any).code = "ENOENT"
				throw error
			}
		}

		// Add the final directory
		currentPath += "/" + parts[parts.length - 1]
		mockDirectories.add(currentPath)
		return Promise.resolve()
	}),

	access: jest.fn().mockImplementation(async (path: string) => {
		// Check if the path exists in either files or directories
		if (mockFiles.has(path) || mockDirectories.has(path) || path.startsWith("/test")) {
			return Promise.resolve()
		}
		const error = new Error(`ENOENT: no such file or directory, access '${path}'`)
		;(error as any).code = "ENOENT"
		throw error
	}),

	rename: jest.fn().mockImplementation(async (oldPath: string, newPath: string) => {
		// Check if the old file exists
		if (mockFiles.has(oldPath)) {
			// Copy content to new path
			const content = mockFiles.get(oldPath)
			mockFiles.set(newPath, content)
			// Delete old file
			mockFiles.delete(oldPath)
			return Promise.resolve()
		}
		// If old file doesn't exist, throw an error
		const error = new Error(`ENOENT: no such file or directory, rename '${oldPath}'`)
		;(error as any).code = "ENOENT"
		throw error
	}),

	constants: jest.requireActual("fs").constants,

	// Expose mock data for test assertions
	_mockFiles: mockFiles,
	_mockDirectories: mockDirectories,

	// Helper to set up initial mock data
	_setInitialMockData: () => {
		// Set up default MCP settings
		mockFiles.set(
			"/mock/settings/path/mcp_settings.json",
			JSON.stringify({
				mcpServers: {
					"test-server": {
						command: "node",
						args: ["test.js"],
						disabled: false,
						alwaysAllow: ["existing-tool"],
					},
				},
			}),
		)

		// Ensure all base directories exist
		baseTestDirs.forEach((dir) => {
			const parts = dir.split("/")
			let currentPath = ""
			for (const part of parts) {
				if (!part) continue
				currentPath += "/" + part
				mockDirectories.add(currentPath)
			}
		})
	},
}

// Initialize mock data
mockFs._setInitialMockData()

module.exports = mockFs
