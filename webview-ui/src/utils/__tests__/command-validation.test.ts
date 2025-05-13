/* eslint-disable no-useless-escape */
/* eslint-disable no-template-curly-in-string */

// npx jest src/utils/__tests__/command-validation.test.ts

import { parseCommand, isAllowedSingleCommand, validateCommand } from "../command-validation"

describe("Command Validation", () => {
	describe("parseCommand", () => {
		it("splits commands by chain operators", () => {
			expect(parseCommand("npm test && npm run build")).toEqual(["npm test", "npm run build"])
			expect(parseCommand("npm test || npm run build")).toEqual(["npm test", "npm run build"])
			expect(parseCommand("npm test; npm run build")).toEqual(["npm test", "npm run build"])
			expect(parseCommand("npm test | npm run build")).toEqual(["npm test", "npm run build"])
		})

		it("preserves quoted content", () => {
			expect(parseCommand('npm test "param with | inside"')).toEqual(['npm test "param with | inside"'])
			expect(parseCommand('echo "hello | world"')).toEqual(['echo "hello | world"'])
			expect(parseCommand('npm test "param with && inside"')).toEqual(['npm test "param with && inside"'])
		})

		it("handles subshell patterns", () => {
			expect(parseCommand("npm test $(echo test)")).toEqual(["npm test", "echo test"])
			expect(parseCommand("npm test `echo test`")).toEqual(["npm test", "echo test"])
		})

		it("handles empty and whitespace input", () => {
			expect(parseCommand("")).toEqual([])
			expect(parseCommand("	")).toEqual([])
			expect(parseCommand("\t")).toEqual([])
		})

		it("handles PowerShell specific patterns", () => {
			expect(parseCommand('npm test 2>&1 | Select-String "Error"')).toEqual([
				"npm test 2>&1",
				'Select-String "Error"',
			])
			expect(
				parseCommand('npm test | Select-String -NotMatch "node_modules" | Select-String "FAIL|Error"'),
			).toEqual(["npm test", 'Select-String -NotMatch "node_modules"', 'Select-String "FAIL|Error"'])
		})
	})

	describe("isAllowedSingleCommand", () => {
		const allowedCommands = ["npm test", "npm run", "echo"]

		it("matches commands case-insensitively", () => {
			expect(isAllowedSingleCommand("NPM TEST", allowedCommands)).toBe(true)
			expect(isAllowedSingleCommand("npm TEST --coverage", allowedCommands)).toBe(true)
			expect(isAllowedSingleCommand("ECHO hello", allowedCommands)).toBe(true)
		})

		it("matches command prefixes", () => {
			expect(isAllowedSingleCommand("npm test --coverage", allowedCommands)).toBe(true)
			expect(isAllowedSingleCommand("npm run build", allowedCommands)).toBe(true)
			expect(isAllowedSingleCommand('echo "hello world"', allowedCommands)).toBe(true)
		})

		it("rejects non-matching commands", () => {
			expect(isAllowedSingleCommand("npmtest", allowedCommands)).toBe(false)
			expect(isAllowedSingleCommand("dangerous", allowedCommands)).toBe(false)
			expect(isAllowedSingleCommand("rm -rf /", allowedCommands)).toBe(false)
		})

		it("handles undefined/empty allowed commands", () => {
			expect(isAllowedSingleCommand("npm test", undefined as any)).toBe(false)
			expect(isAllowedSingleCommand("npm test", [])).toBe(false)
		})
	})

	describe("validateCommand", () => {
		const allowedCommands = ["npm test", "npm run", "echo", "Select-String"]

		it("validates simple commands", () => {
			expect(validateCommand("npm test", allowedCommands)).toBe(true)
			expect(validateCommand("npm run build", allowedCommands)).toBe(true)
			expect(validateCommand("dangerous", allowedCommands)).toBe(false)
		})

		it("validates chained commands", () => {
			expect(validateCommand("npm test && npm run build", allowedCommands)).toBe(true)
			expect(validateCommand("npm test && dangerous", allowedCommands)).toBe(false)
			expect(validateCommand('npm test | Select-String "Error"', allowedCommands)).toBe(true)
			expect(validateCommand("npm test | rm -rf /", allowedCommands)).toBe(false)
		})

		it("handles quoted content correctly", () => {
			expect(validateCommand('npm test "param with | inside"', allowedCommands)).toBe(true)
			expect(validateCommand('echo "hello | world"', allowedCommands)).toBe(true)
			expect(validateCommand('npm test "param with && inside"', allowedCommands)).toBe(true)
		})

		it("handles subshell execution attempts", () => {
			expect(validateCommand("npm test $(echo dangerous)", allowedCommands)).toBe(false)
			expect(validateCommand("npm test `rm -rf /`", allowedCommands)).toBe(false)
		})

		it("handles PowerShell patterns", () => {
			expect(validateCommand('npm test 2>&1 | Select-String "Error"', allowedCommands)).toBe(true)
			expect(
				validateCommand(
					'npm test | Select-String -NotMatch "node_modules" | Select-String "FAIL|Error"',
					allowedCommands,
				),
			).toBe(true)
			expect(validateCommand("npm test | Select-String | dangerous", allowedCommands)).toBe(false)
		})

		it("handles empty input", () => {
			expect(validateCommand("", allowedCommands)).toBe(true)
			expect(validateCommand("	", allowedCommands)).toBe(true)
		})

		it("allows all commands when wildcard is present", () => {
			const wildcardAllowedCommands = ["*"]
			// Should allow any command, including dangerous ones
			expect(validateCommand("rm -rf /", wildcardAllowedCommands)).toBe(true)
			expect(validateCommand("dangerous-command", wildcardAllowedCommands)).toBe(true)
			expect(validateCommand("npm test && rm -rf /", wildcardAllowedCommands)).toBe(true)
			// Should even allow subshell commands that are normally blocked
			expect(validateCommand("npm test $(echo dangerous)", wildcardAllowedCommands)).toBe(true)
			expect(validateCommand("npm test `rm -rf /`", wildcardAllowedCommands)).toBe(true)
		})
	})
})

/**
 * Tests for the command-validation module
 *
 * These tests include a reproduction of a bug where the shell-quote library
 * used in parseCommand throws an error when parsing commands that contain
 * the Bash $RANDOM variable in array indexing expressions.
 *
 * Error: "Bad substitution: levels[$RANDOM"
 *
 * The issue occurs specifically with complex expressions like:
 * ${levels[$RANDOM % ${#levels[@]}]}
 */
describe("command-validation", () => {
	describe("parseCommand", () => {
		it("should correctly parse simple commands", () => {
			const result = parseCommand("echo hello")
			expect(result).toEqual(["echo hello"])
		})

		it("should correctly parse commands with chaining operators", () => {
			const result = parseCommand("echo hello && echo world")
			expect(result).toEqual(["echo hello", "echo world"])
		})

		it("should correctly parse commands with quotes", () => {
			const result = parseCommand('echo "hello world"')
			expect(result).toEqual(['echo "hello world"'])
		})

		it("should correctly parse commands with redirections", () => {
			const result = parseCommand("echo hello 2>&1")
			expect(result).toEqual(["echo hello 2>&1"])
		})

		it("should correctly parse commands with subshells", () => {
			const result = parseCommand("echo $(date)")
			expect(result).toEqual(["echo", "date"])
		})

		it("should not throw an error when parsing commands with simple array indexing", () => {
			// Simple array indexing works fine
			const commandWithArrayIndex = "value=${array[$index]}"

			expect(() => {
				parseCommand(commandWithArrayIndex)
			}).not.toThrow()
		})

		it("should not throw an error when parsing commands with $RANDOM in array index", () => {
			// This test reproduces the specific bug reported in the error
			const commandWithRandom = "level=${levels[$RANDOM % ${#levels[@]}]}"

			expect(() => {
				parseCommand(commandWithRandom)
			}).not.toThrow()
		})

		it("should not throw an error with simple $RANDOM variable", () => {
			// Simple $RANDOM usage works fine
			const commandWithRandom = "echo $RANDOM"

			expect(() => {
				parseCommand(commandWithRandom)
			}).not.toThrow()
		})

		it("should not throw an error with simple array indexing using $RANDOM", () => {
			// Simple array indexing with $RANDOM works fine
			const commandWithRandomIndex = "echo ${array[$RANDOM]}"

			expect(() => {
				parseCommand(commandWithRandomIndex)
			}).not.toThrow()
		})

		it("should not throw an error with complex array indexing using $RANDOM and arithmetic", () => {
			// This test reproduces the exact expression from the original error
			const commandWithComplexRandom = "echo ${levels[$RANDOM % ${#levels[@]}]}"

			expect(() => {
				parseCommand(commandWithComplexRandom)
			}).not.toThrow("Bad substitution")
		})

		it("should not throw an error when parsing the full log generator command", () => {
			// This is the exact command from the original error message
			const logGeneratorCommand = `while true; do \\
  levels=(INFO WARN ERROR DEBUG); \\
  msgs=("User logged in" "Connection timeout" "Processing request" "Cache miss" "Database query"); \\
  level=\${levels[$RANDOM % \${#levels[@]}]}; \\
  msg=\${msgs[$RANDOM % \${#msgs[@]}]}; \\
  echo "\$(date '+%Y-%m-%d %H:%M:%S') [$level] $msg"; \\
  sleep 1; \\
done`

			// This reproduces the original error
			expect(() => {
				parseCommand(logGeneratorCommand)
			}).not.toThrow("Bad substitution: levels[$RANDOM")
		})

		it("should not throw an error when parsing just the problematic part", () => {
			// This isolates just the part mentioned in the error message
			const problematicPart = "level=${levels[$RANDOM"

			expect(() => {
				parseCommand(problematicPart)
			}).not.toThrow("Bad substitution")
		})
	})

	describe("validateCommand", () => {
		it("should validate allowed commands", () => {
			const result = validateCommand("echo hello", ["echo"])
			expect(result).toBe(true)
		})

		it("should reject disallowed commands", () => {
			const result = validateCommand("rm -rf /", ["echo", "ls"])
			expect(result).toBe(false)
		})

		it("should not fail validation for commands with simple $RANDOM variable", () => {
			const commandWithRandom = "echo $RANDOM"

			expect(() => {
				validateCommand(commandWithRandom, ["echo"])
			}).not.toThrow()
		})

		it("should not fail validation for commands with simple array indexing using $RANDOM", () => {
			const commandWithRandomIndex = "echo ${array[$RANDOM]}"

			expect(() => {
				validateCommand(commandWithRandomIndex, ["echo"])
			}).not.toThrow()
		})

		it("should return false for the full log generator command due to subshell detection", () => {
			// This is the exact command from the original error message
			const logGeneratorCommand = `while true; do \\
  levels=(INFO WARN ERROR DEBUG); \\
  msgs=("User logged in" "Connection timeout" "Processing request" "Cache miss" "Database query"); \\
  level=\${levels[$RANDOM % \${#levels[@]}]}; \\
  msg=\${msgs[$RANDOM % \${#msgs[@]}]}; \\
  echo "\$(date '+%Y-%m-%d %H:%M:%S') [$level] $msg"; \\
  sleep 1; \\
done`

			// validateCommand should return false due to subshell detection
			// without throwing an error
			const result = validateCommand(logGeneratorCommand, ["while"])
			expect(result).toBe(false)
		})
	})
})
