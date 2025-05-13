import { parseCommand, validateCommand } from "../../utils/command-validation"

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
