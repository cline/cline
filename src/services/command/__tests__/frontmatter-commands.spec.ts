import fs from "fs/promises"
import * as path from "path"

import { getCommand, getCommands } from "../commands"

// Mock fs and path modules
vi.mock("fs/promises")
vi.mock("../roo-config", () => ({
	getGlobalRooDirectory: vi.fn(() => "/mock/global/.roo"),
	getProjectRooDirectoryForCwd: vi.fn(() => "/mock/project/.roo"),
}))
vi.mock("../built-in-commands", () => ({
	getBuiltInCommands: vi.fn(() => Promise.resolve([])),
	getBuiltInCommand: vi.fn(() => Promise.resolve(undefined)),
	getBuiltInCommandNames: vi.fn(() => Promise.resolve([])),
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
				argumentHint: undefined,
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
				argumentHint: undefined,
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
				argumentHint: undefined,
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
				argumentHint: undefined,
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
				argumentHint: undefined,
			})
		})
	})

	describe("argument-hint functionality", () => {
		it("should load command with argument-hint from frontmatter", async () => {
			const commandContent = `---
description: Create a new release of the Roo Code extension
argument-hint: patch | minor | major
---

# Release Command

Create a new release.`

			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readFile = vi.fn().mockResolvedValue(commandContent)

			const result = await getCommand("/test/cwd", "release")

			expect(result).toEqual({
				name: "release",
				content: "# Release Command\n\nCreate a new release.",
				source: "project",
				filePath: path.join("/test/cwd", ".roo", "commands", "release.md"),
				description: "Create a new release of the Roo Code extension",
				argumentHint: "patch | minor | major",
			})
		})

		it("should handle command with both description and argument-hint", async () => {
			const commandContent = `---
description: Deploy application to environment
argument-hint: staging | production
author: DevOps Team
---

# Deploy Command

Deploy the application.`

			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readFile = vi.fn().mockResolvedValue(commandContent)

			const result = await getCommand("/test/cwd", "deploy")

			expect(result).toEqual({
				name: "deploy",
				content: "# Deploy Command\n\nDeploy the application.",
				source: "project",
				filePath: path.join("/test/cwd", ".roo", "commands", "deploy.md"),
				description: "Deploy application to environment",
				argumentHint: "staging | production",
			})
		})

		it("should handle empty argument-hint in frontmatter", async () => {
			const commandContent = `---
description: Test command
argument-hint: ""
---

# Test Command

Test content.`

			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readFile = vi.fn().mockResolvedValue(commandContent)

			const result = await getCommand("/test/cwd", "test")

			expect(result?.argumentHint).toBeUndefined()
		})

		it("should handle whitespace-only argument-hint in frontmatter", async () => {
			const commandContent = `---
description: Test command
argument-hint: "   "
---

# Test Command

Test content.`

			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readFile = vi.fn().mockResolvedValue(commandContent)

			const result = await getCommand("/test/cwd", "test")

			expect(result?.argumentHint).toBeUndefined()
		})

		it("should handle non-string argument-hint in frontmatter", async () => {
			const commandContent = `---
description: Test command
argument-hint: 123
---

# Test Command

Test content.`

			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readFile = vi.fn().mockResolvedValue(commandContent)

			const result = await getCommand("/test/cwd", "test")

			expect(result?.argumentHint).toBeUndefined()
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
						argumentHint: undefined,
					}),
					expect.objectContaining({
						name: "deploy",
						description: "Deploys the application to production",
						argumentHint: undefined,
					}),
					expect.objectContaining({
						name: "build",
						description: undefined,
						argumentHint: undefined,
					}),
				]),
			)
		})

		it("should load multiple commands with argument hints", async () => {
			const releaseContent = `---
description: Create a new release
argument-hint: patch | minor | major
---

# Release Command

Create a release.`

			const deployContent = `---
description: Deploy to environment
argument-hint: staging | production
---

# Deploy Command

Deploy the app.`

			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readdir = vi.fn().mockResolvedValue([
				{ name: "release.md", isFile: () => true },
				{ name: "deploy.md", isFile: () => true },
			])
			mockFs.readFile = vi.fn().mockResolvedValueOnce(releaseContent).mockResolvedValueOnce(deployContent)

			const result = await getCommands("/test/cwd")

			expect(result).toHaveLength(2)
			expect(result).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "release",
						description: "Create a new release",
						argumentHint: "patch | minor | major",
					}),
					expect.objectContaining({
						name: "deploy",
						description: "Deploy to environment",
						argumentHint: "staging | production",
					}),
				]),
			)
		})
	})
})
