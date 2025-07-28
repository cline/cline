import { describe, it, expect, beforeEach, vi } from "vitest"
import fs from "fs/promises"
import * as path from "path"
import { getCommand, getCommands } from "../commands"

// Mock fs and path modules
vi.mock("fs/promises")
vi.mock("../roo-config", () => ({
	getGlobalRooDirectory: vi.fn(() => "/mock/global/.roo"),
	getProjectRooDirectoryForCwd: vi.fn(() => "/mock/project/.roo"),
}))

const mockFs = vi.mocked(fs)

describe("Command loading with frontmatter", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getCommand with frontmatter", () => {
		it("should load command with description from frontmatter", async () => {
			const commandContent = `---
description: Sets up the development environment
author: John Doe
---

# Setup Command

Run the following commands:
\`\`\`bash
npm install
npm run build
\`\`\``

			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readFile = vi.fn().mockResolvedValue(commandContent)

			const result = await getCommand("/test/cwd", "setup")

			expect(result).toEqual({
				name: "setup",
				content: "# Setup Command\n\nRun the following commands:\n```bash\nnpm install\nnpm run build\n```",
				source: "project",
				filePath: path.join("/test/cwd", ".roo", "commands", "setup.md"),
				description: "Sets up the development environment",
			})
		})

		it("should load command without frontmatter", async () => {
			const commandContent = `# Setup Command

Run the following commands:
\`\`\`bash
npm install
npm run build
\`\`\``

			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readFile = vi.fn().mockResolvedValue(commandContent)

			const result = await getCommand("/test/cwd", "setup")

			expect(result).toEqual({
				name: "setup",
				content: "# Setup Command\n\nRun the following commands:\n```bash\nnpm install\nnpm run build\n```",
				source: "project",
				filePath: path.join("/test/cwd", ".roo", "commands", "setup.md"),
				description: undefined,
			})
		})

		it("should handle empty description in frontmatter", async () => {
			const commandContent = `---
description: ""
author: John Doe
---

# Setup Command

Command content here.`

			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readFile = vi.fn().mockResolvedValue(commandContent)

			const result = await getCommand("/test/cwd", "setup")

			expect(result?.description).toBeUndefined()
		})

		it("should handle malformed frontmatter gracefully", async () => {
			const commandContent = `---
description: Test
invalid: yaml: [
---

# Setup Command

Command content here.`

			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readFile = vi.fn().mockResolvedValue(commandContent)

			const result = await getCommand("/test/cwd", "setup")

			expect(result).toEqual({
				name: "setup",
				content: commandContent.trim(),
				source: "project",
				filePath: path.join("/test/cwd", ".roo", "commands", "setup.md"),
				description: undefined,
			})
		})

		it("should prioritize project commands over global commands", async () => {
			const projectCommandContent = `---
description: Project-specific setup
---

# Project Setup

Project-specific setup instructions.`

			const globalCommandContent = `---
description: Global setup
---

# Global Setup

Global setup instructions.`

			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readFile = vi
				.fn()
				.mockResolvedValueOnce(projectCommandContent) // First call for project
				.mockResolvedValueOnce(globalCommandContent) // Second call for global (shouldn't be used)

			const result = await getCommand("/test/cwd", "setup")

			expect(result).toEqual({
				name: "setup",
				content: "# Project Setup\n\nProject-specific setup instructions.",
				source: "project",
				filePath: path.join("/test/cwd", ".roo", "commands", "setup.md"),
				description: "Project-specific setup",
			})
		})

		it("should fall back to global command if project command doesn't exist", async () => {
			const globalCommandContent = `---
description: Global setup command
---

# Global Setup

Global setup instructions.`

			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readFile = vi
				.fn()
				.mockRejectedValueOnce(new Error("File not found")) // Project command doesn't exist
				.mockResolvedValueOnce(globalCommandContent) // Global command exists

			const result = await getCommand("/test/cwd", "setup")

			expect(result).toEqual({
				name: "setup",
				content: "# Global Setup\n\nGlobal setup instructions.",
				source: "global",
				filePath: expect.stringContaining(path.join(".roo", "commands", "setup.md")),
				description: "Global setup command",
			})
		})
	})

	describe("getCommands with frontmatter", () => {
		it("should load multiple commands with descriptions", async () => {
			const setupContent = `---
description: Sets up the development environment
---

# Setup Command

Setup instructions.`

			const deployContent = `---
description: Deploys the application to production
---

# Deploy Command

Deploy instructions.`

			const buildContent = `# Build Command

Build instructions without frontmatter.`

			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readdir = vi.fn().mockResolvedValue([
				{ name: "setup.md", isFile: () => true },
				{ name: "deploy.md", isFile: () => true },
				{ name: "build.md", isFile: () => true },
				{ name: "not-markdown.txt", isFile: () => true }, // Should be ignored
			])
			mockFs.readFile = vi
				.fn()
				.mockResolvedValueOnce(setupContent)
				.mockResolvedValueOnce(deployContent)
				.mockResolvedValueOnce(buildContent)

			const result = await getCommands("/test/cwd")

			expect(result).toHaveLength(3)
			expect(result).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "setup",
						description: "Sets up the development environment",
					}),
					expect.objectContaining({
						name: "deploy",
						description: "Deploys the application to production",
					}),
					expect.objectContaining({
						name: "build",
						description: undefined,
					}),
				]),
			)
		})
	})
})
