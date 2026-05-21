import { describe, it } from "mocha"
import "should"
import { escapeShellPath } from "../shell-escape"

describe("Shell Path Escaping", () => {
	const originalPlatform = process.platform

	// Helper to temporarily set platform
	const setPlatform = (platform: NodeJS.Platform) => {
		Object.defineProperty(process, "platform", {
			value: platform,
			writable: true,
			configurable: true,
		})
	}

	// Restore platform after tests
	after(() => {
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
			writable: true,
			configurable: true,
		})
	})

	describe("Unix/Linux/macOS path escaping", () => {
		before(() => {
			setPlatform("darwin") // macOS, but same escaping as Linux
		})

		it("should handle paths without special characters", () => {
			const path = "/Users/user/Documents/Cline/Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/user/Documents/Cline/Hooks/PreToolUse'")
		})

		it("should handle paths with spaces", () => {
			const path = "/Users/user/My Project/Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/user/My Project/Hooks/PreToolUse'")
		})

		it("should handle paths with multiple spaces", () => {
			const path = "/Users/user/My Test   Project/Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/user/My Test   Project/Hooks/PreToolUse'")
		})

		it("should handle paths with single quotes", () => {
			const path = "/Users/user/Test's Project/Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			// Single quote is escaped as '\'' (close quote, escaped quote, open quote)
			escaped.should.equal("'/Users/user/Test'\\''s Project/Hooks/PreToolUse'")
		})

		it("should handle paths with multiple single quotes", () => {
			const path = "/Users/user/Test's Project's Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/user/Test'\\''s Project'\\''s Hooks/PreToolUse'")
		})

		it("should handle paths with double quotes", () => {
			const path = '/Users/user/Test "Quoted" Project/Hooks/PreToolUse'
			const escaped = escapeShellPath(path)
			// Double quotes are safe inside single quotes
			escaped.should.equal("'/Users/user/Test \"Quoted\" Project/Hooks/PreToolUse'")
		})

		it("should handle paths with special shell characters", () => {
			const path = "/Users/user/Test$Project/Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			// Special characters like $ are safe inside single quotes
			escaped.should.equal("'/Users/user/Test$Project/Hooks/PreToolUse'")
		})

		it("should handle paths with backticks", () => {
			const path = "/Users/user/Test`Project/Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			// Backticks are safe inside single quotes
			escaped.should.equal("'/Users/user/Test`Project/Hooks/PreToolUse'")
		})

		it("should handle paths with parentheses", () => {
			const path = "/Users/user/Test (Project)/Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/user/Test (Project)/Hooks/PreToolUse'")
		})

		it("should handle paths with ampersands", () => {
			const path = "/Users/user/Test & Project/Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/user/Test & Project/Hooks/PreToolUse'")
		})

		it("should handle paths with semicolons", () => {
			const path = "/Users/user/Test;Project/Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/user/Test;Project/Hooks/PreToolUse'")
		})

		it("should handle paths with pipes", () => {
			const path = "/Users/user/Test|Project/Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/user/Test|Project/Hooks/PreToolUse'")
		})

		it("should handle global hooks directory with spaces", () => {
			const path = "/Users/user name/Documents/Cline/Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/user name/Documents/Cline/Hooks/PreToolUse'")
		})

		it("should handle workspace hooks with spaces in root", () => {
			const path = "/Users/user/My Example Project/.clinerules/hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/user/My Example Project/.clinerules/hooks/PreToolUse'")
		})

		it("should handle paths with newlines (edge case)", () => {
			const path = "/Users/user/Test\nProject/Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			// Newlines are safe inside single quotes
			escaped.should.equal("'/Users/user/Test\nProject/Hooks/PreToolUse'")
		})

		it("should handle paths with tabs", () => {
			const path = "/Users/user/Test\tProject/Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/user/Test\tProject/Hooks/PreToolUse'")
		})
	})

	describe("Windows path escaping", () => {
		before(() => {
			setPlatform("win32")
		})

		it("should handle paths without special characters", () => {
			const path = "C:\\Users\\user\\Documents\\Cline\\Hooks\\PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal('"C:\\Users\\user\\Documents\\Cline\\Hooks\\PreToolUse"')
		})

		it("should handle paths with spaces", () => {
			const path = "C:\\Users\\user\\My Project\\Hooks\\PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal('"C:\\Users\\user\\My Project\\Hooks\\PreToolUse"')
		})

		it("should handle paths with multiple spaces", () => {
			const path = "C:\\Users\\user\\My Test   Project\\Hooks\\PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal('"C:\\Users\\user\\My Test   Project\\Hooks\\PreToolUse"')
		})

		it("should handle paths with double quotes", () => {
			const path = 'C:\\Users\\user\\Test "Quoted" Project\\Hooks\\PreToolUse'
			const escaped = escapeShellPath(path)
			// Double quotes are escaped by doubling them
			escaped.should.equal('"C:\\Users\\user\\Test ""Quoted"" Project\\Hooks\\PreToolUse"')
		})

		it("should handle paths with backslashes before quotes", () => {
			const path = 'C:\\Users\\user\\Test\\"Project\\Hooks\\PreToolUse'
			const escaped = escapeShellPath(path)
			// Backslash before quote needs to be doubled, then quote is doubled
			escaped.should.equal('"C:\\Users\\user\\Test\\\\""Project\\Hooks\\PreToolUse"')
		})

		it("should handle paths with single quotes", () => {
			const path = "C:\\Users\\user\\Test's Project\\Hooks\\PreToolUse"
			const escaped = escapeShellPath(path)
			// Single quotes are safe inside double quotes on Windows
			escaped.should.equal('"C:\\Users\\user\\Test\'s Project\\Hooks\\PreToolUse"')
		})

		it("should handle paths with special characters", () => {
			const path = "C:\\Users\\user\\Test$Project\\Hooks\\PreToolUse"
			const escaped = escapeShellPath(path)
			// Most special characters are safe inside double quotes on Windows
			escaped.should.equal('"C:\\Users\\user\\Test$Project\\Hooks\\PreToolUse"')
		})

		it("should handle paths with parentheses", () => {
			const path = "C:\\Users\\user\\Test (Project)\\Hooks\\PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal('"C:\\Users\\user\\Test (Project)\\Hooks\\PreToolUse"')
		})

		it("should handle paths with ampersands", () => {
			const path = "C:\\Users\\user\\Test & Project\\Hooks\\PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal('"C:\\Users\\user\\Test & Project\\Hooks\\PreToolUse"')
		})

		it("should handle global hooks directory with spaces", () => {
			const path = "C:\\Users\\user name\\Documents\\Cline\\Hooks\\PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal('"C:\\Users\\user name\\Documents\\Cline\\Hooks\\PreToolUse"')
		})

		it("should handle workspace hooks with spaces in root", () => {
			const path = "C:\\Users\\user\\My Example Project\\.clinerules\\hooks\\PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal('"C:\\Users\\user\\My Example Project\\.clinerules\\hooks\\PreToolUse"')
		})

		it("should handle UNC paths with spaces", () => {
			const path = "\\\\server\\share\\My Project\\Hooks\\PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal('"\\\\server\\share\\My Project\\Hooks\\PreToolUse"')
		})
	})

	describe("Real-world scenarios", () => {
		it("should handle typical macOS global hooks path with space in username", () => {
			setPlatform("darwin")
			const path = "/Users/John Doe/Documents/Cline/Hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/John Doe/Documents/Cline/Hooks/PreToolUse'")
		})

		it("should handle typical Windows global hooks path with space in username", () => {
			setPlatform("win32")
			const path = "C:\\Users\\John Doe\\Documents\\Cline\\Hooks\\PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal('"C:\\Users\\John Doe\\Documents\\Cline\\Hooks\\PreToolUse"')
		})

		it("should handle workspace with company name and spaces", () => {
			setPlatform("darwin")
			const path = "/Users/user/Projects/ACME Corp Project/.clinerules/hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/user/Projects/ACME Corp Project/.clinerules/hooks/PreToolUse'")
		})

		it("should handle workspace with version numbers and spaces", () => {
			setPlatform("darwin")
			const path = "/Users/user/Projects/My Project v2.0/.clinerules/hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/user/Projects/My Project v2.0/.clinerules/hooks/PreToolUse'")
		})

		it("should handle workspace with mixed special characters", () => {
			setPlatform("darwin")
			const path = "/Users/user/Projects/Test's (New) Project v2.0/.clinerules/hooks/PreToolUse"
			const escaped = escapeShellPath(path)
			escaped.should.equal("'/Users/user/Projects/Test'\\''s (New) Project v2.0/.clinerules/hooks/PreToolUse'")
		})
	})

	describe("Multi-root workspace scenarios", () => {
		it("should handle multiple roots with spaces (macOS)", () => {
			setPlatform("darwin")
			const roots = [
				"/Users/user/My Frontend Project/.clinerules/hooks/PreToolUse",
				"/Users/user/My Backend Project/.clinerules/hooks/PreToolUse",
				"/Users/user/Shared Utils/.clinerules/hooks/PreToolUse",
			]

			const escaped = roots.map(escapeShellPath)
			escaped.should.deepEqual([
				"'/Users/user/My Frontend Project/.clinerules/hooks/PreToolUse'",
				"'/Users/user/My Backend Project/.clinerules/hooks/PreToolUse'",
				"'/Users/user/Shared Utils/.clinerules/hooks/PreToolUse'",
			])
		})

		it("should handle multiple roots with spaces (Windows)", () => {
			setPlatform("win32")
			const roots = [
				"C:\\Users\\user\\My Frontend Project\\.clinerules\\hooks\\PreToolUse",
				"C:\\Users\\user\\My Backend Project\\.clinerules\\hooks\\PreToolUse",
				"C:\\Users\\user\\Shared Utils\\.clinerules\\hooks\\PreToolUse",
			]

			const escaped = roots.map(escapeShellPath)
			escaped.should.deepEqual([
				'"C:\\Users\\user\\My Frontend Project\\.clinerules\\hooks\\PreToolUse"',
				'"C:\\Users\\user\\My Backend Project\\.clinerules\\hooks\\PreToolUse"',
				'"C:\\Users\\user\\Shared Utils\\.clinerules\\hooks\\PreToolUse"',
			])
		})
	})
})
