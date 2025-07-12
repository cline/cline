/* eslint-disable no-useless-escape */

// npx vitest src/utils/__tests__/command-validation.spec.ts

import {
	parseCommand,
	isAutoApprovedSingleCommand,
	isAutoDeniedSingleCommand,
	isAutoApprovedCommand,
	isAutoDeniedCommand,
	findLongestPrefixMatch,
	getCommandDecision,
	getSingleCommandDecision,
	CommandValidator,
	createCommandValidator,
} from "../command-validation"

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

	describe("isAutoApprovedSingleCommand (legacy behavior)", () => {
		const allowedCommands = ["npm test", "npm run", "echo"]

		it("matches commands case-insensitively", () => {
			expect(isAutoApprovedSingleCommand("NPM TEST", allowedCommands)).toBe(true)
			expect(isAutoApprovedSingleCommand("npm TEST --coverage", allowedCommands)).toBe(true)
			expect(isAutoApprovedSingleCommand("ECHO hello", allowedCommands)).toBe(true)
		})

		it("matches command prefixes", () => {
			expect(isAutoApprovedSingleCommand("npm test --coverage", allowedCommands)).toBe(true)
			expect(isAutoApprovedSingleCommand("npm run build", allowedCommands)).toBe(true)
			expect(isAutoApprovedSingleCommand('echo "hello world"', allowedCommands)).toBe(true)
		})

		it("rejects non-matching commands", () => {
			expect(isAutoApprovedSingleCommand("npmtest", allowedCommands)).toBe(false)
			expect(isAutoApprovedSingleCommand("dangerous", allowedCommands)).toBe(false)
			expect(isAutoApprovedSingleCommand("rm -rf /", allowedCommands)).toBe(false)
		})

		it("handles undefined/empty allowed commands", () => {
			expect(isAutoApprovedSingleCommand("npm test", undefined as any)).toBe(false)
			expect(isAutoApprovedSingleCommand("npm test", [])).toBe(false)
		})
	})

	describe("isAutoApprovedCommand (legacy behavior)", () => {
		const allowedCommands = ["npm test", "npm run", "echo", "Select-String"]

		it("validates simple commands", () => {
			expect(isAutoApprovedCommand("npm test", allowedCommands)).toBe(true)
			expect(isAutoApprovedCommand("npm run build", allowedCommands)).toBe(true)
			expect(isAutoApprovedCommand("dangerous", allowedCommands)).toBe(false)
		})

		it("validates chained commands", () => {
			expect(isAutoApprovedCommand("npm test && npm run build", allowedCommands)).toBe(true)
			expect(isAutoApprovedCommand("npm test && dangerous", allowedCommands)).toBe(false)
			expect(isAutoApprovedCommand('npm test | Select-String "Error"', allowedCommands)).toBe(true)
			expect(isAutoApprovedCommand("npm test | rm -rf /", allowedCommands)).toBe(false)
		})

		it("handles quoted content correctly", () => {
			expect(isAutoApprovedCommand('npm test "param with | inside"', allowedCommands)).toBe(true)
			expect(isAutoApprovedCommand('echo "hello | world"', allowedCommands)).toBe(true)
			expect(isAutoApprovedCommand('npm test "param with && inside"', allowedCommands)).toBe(true)
		})

		it("handles subshell execution attempts", () => {
			// Without denylist, subshells should be allowed if all subcommands are allowed
			expect(isAutoApprovedCommand("npm test $(echo hello)", allowedCommands)).toBe(true)
			expect(isAutoApprovedCommand("npm test `echo world`", allowedCommands)).toBe(true)

			// With denylist, subshells should be blocked regardless of subcommands
			expect(isAutoApprovedCommand("npm test $(echo hello)", allowedCommands, ["rm"])).toBe(false)
			expect(isAutoApprovedCommand("npm test `echo world`", allowedCommands, ["rm"])).toBe(false)
		})

		it("handles PowerShell patterns", () => {
			expect(isAutoApprovedCommand('npm test 2>&1 | Select-String "Error"', allowedCommands)).toBe(true)
			expect(
				isAutoApprovedCommand(
					'npm test | Select-String -NotMatch "node_modules" | Select-String "FAIL|Error"',
					allowedCommands,
				),
			).toBe(true)
			expect(isAutoApprovedCommand("npm test | Select-String | dangerous", allowedCommands)).toBe(false)
		})

		it("handles empty input", () => {
			expect(isAutoApprovedCommand("", allowedCommands)).toBe(true)
			expect(isAutoApprovedCommand("	", allowedCommands)).toBe(true)
		})

		it("allows all commands when wildcard is present", () => {
			const wildcardAllowedCommands = ["*"]
			// Should allow any command, including dangerous ones
			expect(isAutoApprovedCommand("rm -rf /", wildcardAllowedCommands)).toBe(true)
			expect(isAutoApprovedCommand("dangerous-command", wildcardAllowedCommands)).toBe(true)
			expect(isAutoApprovedCommand("npm test && rm -rf /", wildcardAllowedCommands)).toBe(true)
			// Should allow subshell commands with wildcard when no denylist is present
			expect(isAutoApprovedCommand("npm test $(echo dangerous)", wildcardAllowedCommands)).toBe(true)
			expect(isAutoApprovedCommand("npm test `rm -rf /`", wildcardAllowedCommands)).toBe(true)

			// But should block subshells when denylist is present
			expect(isAutoApprovedCommand("npm test $(echo dangerous)", wildcardAllowedCommands, ["rm"])).toBe(false)
			expect(isAutoApprovedCommand("npm test `rm -rf /`", wildcardAllowedCommands, ["rm"])).toBe(false)
		})

		it("respects denylist even with wildcard in allowlist", () => {
			const wildcardAllowedCommands = ["*"]
			const deniedCommands = ["rm -rf", "dangerous"]

			// Wildcard should allow most commands
			expect(isAutoApprovedCommand("npm test", wildcardAllowedCommands, deniedCommands)).toBe(true)
			expect(isAutoApprovedCommand("echo hello", wildcardAllowedCommands, deniedCommands)).toBe(true)
			expect(isAutoApprovedCommand("git status", wildcardAllowedCommands, deniedCommands)).toBe(true)

			// But denylist should still block specific commands
			expect(isAutoApprovedCommand("rm -rf /", wildcardAllowedCommands, deniedCommands)).toBe(false)
			expect(isAutoApprovedCommand("dangerous-command", wildcardAllowedCommands, deniedCommands)).toBe(false)

			// Chained commands with denied subcommands should be blocked
			expect(isAutoApprovedCommand("npm test && rm -rf /", wildcardAllowedCommands, deniedCommands)).toBe(false)
			expect(
				isAutoApprovedCommand("echo hello && dangerous-command", wildcardAllowedCommands, deniedCommands),
			).toBe(false)

			// But chained commands with all allowed subcommands should work
			expect(isAutoApprovedCommand("npm test && echo done", wildcardAllowedCommands, deniedCommands)).toBe(true)
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

	describe("isAutoApprovedCommand (legacy behavior)", () => {
		it("should validate allowed commands", () => {
			const result = isAutoApprovedCommand("echo hello", ["echo"])
			expect(result).toBe(true)
		})

		it("should reject disallowed commands", () => {
			const result = isAutoApprovedCommand("rm -rf /", ["echo", "ls"])
			expect(result).toBe(false)
		})

		it("should not fail validation for commands with simple $RANDOM variable", () => {
			const commandWithRandom = "echo $RANDOM"

			expect(() => {
				isAutoApprovedCommand(commandWithRandom, ["echo"])
			}).not.toThrow()
		})

		it("should not fail validation for commands with simple array indexing using $RANDOM", () => {
			const commandWithRandomIndex = "echo ${array[$RANDOM]}"

			expect(() => {
				isAutoApprovedCommand(commandWithRandomIndex, ["echo"])
			}).not.toThrow()
		})

		it("should return false for the full log generator command due to subshell detection when denylist is present", () => {
			// This is the exact command from the original error message
			const logGeneratorCommand = `while true; do \\
		levels=(INFO WARN ERROR DEBUG); \\
		msgs=("User logged in" "Connection timeout" "Processing request" "Cache miss" "Database query"); \\
		level=\${levels[$RANDOM % \${#levels[@]}]}; \\
		msg=\${msgs[$RANDOM % \${#msgs[@]}]}; \\
		echo "\$(date '+%Y-%m-%d %H:%M:%S') [$level] $msg"; \\
		sleep 1; \\
done`

			// Without denylist, should allow subshells if all subcommands are allowed (use wildcard)
			expect(isAutoApprovedCommand(logGeneratorCommand, ["*"])).toBe(true)

			// With denylist, should return false due to subshell detection
			expect(isAutoApprovedCommand(logGeneratorCommand, ["*"], ["rm"])).toBe(false)
		})
	})

	describe("Denylist Command Validation", () => {
		describe("findLongestPrefixMatch", () => {
			it("finds the longest matching prefix", () => {
				const prefixes = ["npm", "npm test", "npm run"]
				expect(findLongestPrefixMatch("npm test --coverage", prefixes)).toBe("npm test")
				expect(findLongestPrefixMatch("npm run build", prefixes)).toBe("npm run")
				expect(findLongestPrefixMatch("npm install", prefixes)).toBe("npm")
			})

			it("returns null when no prefix matches", () => {
				const prefixes = ["npm", "echo"]
				expect(findLongestPrefixMatch("rm -rf /", prefixes)).toBe(null)
				expect(findLongestPrefixMatch("dangerous", prefixes)).toBe(null)
			})

			it("handles case insensitive matching", () => {
				const prefixes = ["npm test", "Echo"]
				expect(findLongestPrefixMatch("NPM TEST --coverage", prefixes)).toBe("npm test")
				expect(findLongestPrefixMatch("echo hello", prefixes)).toBe("echo")
			})

			it("handles empty inputs", () => {
				expect(findLongestPrefixMatch("", ["npm"])).toBe(null)
				expect(findLongestPrefixMatch("npm test", [])).toBe(null)
				expect(findLongestPrefixMatch("npm test", undefined as any)).toBe(null)
			})
		})

		describe("Legacy isAllowedSingleCommand behavior (now using isAutoApprovedSingleCommand)", () => {
			const allowedCommands = ["npm", "echo", "git"]
			const deniedCommands = ["npm test", "git push"]

			it("allows commands that match allowlist but not denylist", () => {
				expect(isAutoApprovedSingleCommand("npm install", allowedCommands, deniedCommands)).toBe(true)
				expect(isAutoApprovedSingleCommand("echo hello", allowedCommands, deniedCommands)).toBe(true)
				expect(isAutoApprovedSingleCommand("git status", allowedCommands, deniedCommands)).toBe(true)
			})

			it("denies commands that match denylist", () => {
				expect(isAutoApprovedSingleCommand("npm test --coverage", allowedCommands, deniedCommands)).toBe(false)
				expect(isAutoApprovedSingleCommand("git push origin main", allowedCommands, deniedCommands)).toBe(false)
			})

			it("uses longest prefix match rule", () => {
				const allowedLong = ["npm", "npm test"]
				const deniedShort = ["npm"]

				// "npm test" is longer than "npm", so it should be allowed
				expect(isAutoApprovedSingleCommand("npm test --coverage", allowedLong, deniedShort)).toBe(true)

				const allowedShort = ["npm"]
				const deniedLong = ["npm test"]

				// "npm test" is longer than "npm", so it should be denied
				expect(isAutoApprovedSingleCommand("npm test --coverage", allowedShort, deniedLong)).toBe(false)
			})

			it("handles wildcard patterns with longest prefix match", () => {
				const allowedWithWildcard = ["*"]
				const deniedWithWildcard = ["*"]

				// Both wildcards have length 1, so it's a tie - longest prefix match rule applies
				// Since both match with same length, denylist wins in tie-breaker
				expect(isAutoApprovedSingleCommand("any command", allowedWithWildcard, deniedWithWildcard)).toBe(false)

				// Test wildcard vs specific pattern
				const allowedWithWildcard2 = ["*"]
				const deniedSpecific = ["rm -rf"]

				// "rm -rf" (length 6) is longer than "*" (length 1), so denylist wins
				expect(isAutoApprovedSingleCommand("rm -rf /", allowedWithWildcard2, deniedSpecific)).toBe(false)
				// Commands not matching "rm -rf" should be allowed by "*"
				expect(isAutoApprovedSingleCommand("npm test", allowedWithWildcard2, deniedSpecific)).toBe(true)
			})

			it("handles specific pattern vs wildcard", () => {
				const allowedSpecific = ["npm test"]
				const deniedWildcard = ["*"]

				// "npm test" (length 8) is longer than "*" (length 1), so allowlist wins
				expect(isAutoApprovedSingleCommand("npm test --coverage", allowedSpecific, deniedWildcard)).toBe(true)
				// Commands not matching "npm test" should be denied by "*"
				expect(isAutoApprovedSingleCommand("git status", allowedSpecific, deniedWildcard)).toBe(false)
			})

			it("denies commands that match neither list", () => {
				expect(isAutoApprovedSingleCommand("dangerous", allowedCommands, deniedCommands)).toBe(false)
				expect(isAutoApprovedSingleCommand("rm -rf /", allowedCommands, deniedCommands)).toBe(false)
			})

			it("handles empty command", () => {
				expect(isAutoApprovedSingleCommand("", allowedCommands, deniedCommands)).toBe(true)
			})

			it("handles empty lists", () => {
				// When both lists are empty, nothing is auto-approved (ask user is default)
				expect(isAutoApprovedSingleCommand("npm test", [], [])).toBe(false)
				expect(isAutoApprovedSingleCommand("npm test", undefined as any, undefined as any)).toBe(false)
			})

			describe("Three-Tier Command Validation", () => {
				const allowedCommands = ["npm", "echo", "git"]
				const deniedCommands = ["npm test", "git push"]

				describe("isAutoApprovedSingleCommand", () => {
					it("auto-approves commands that match allowlist but not denylist", () => {
						expect(isAutoApprovedSingleCommand("npm install", allowedCommands, deniedCommands)).toBe(true)
						expect(isAutoApprovedSingleCommand("echo hello", allowedCommands, deniedCommands)).toBe(true)
						expect(isAutoApprovedSingleCommand("git status", allowedCommands, deniedCommands)).toBe(true)
					})

					it("does not auto-approve commands that match denylist", () => {
						expect(
							isAutoApprovedSingleCommand("npm test --coverage", allowedCommands, deniedCommands),
						).toBe(false)
						expect(
							isAutoApprovedSingleCommand("git push origin main", allowedCommands, deniedCommands),
						).toBe(false)
					})

					it("does not auto-approve commands that match neither list", () => {
						expect(isAutoApprovedSingleCommand("dangerous", allowedCommands, deniedCommands)).toBe(false)
						expect(isAutoApprovedSingleCommand("rm -rf /", allowedCommands, deniedCommands)).toBe(false)
					})

					it("does not auto-approve when no allowlist configured", () => {
						expect(isAutoApprovedSingleCommand("npm test", [], deniedCommands)).toBe(false)
						expect(isAutoApprovedSingleCommand("npm test", undefined as any, deniedCommands)).toBe(false)
					})

					it("uses longest prefix match rule for auto-approval", () => {
						const allowedLong = ["npm", "npm test"]
						const deniedShort = ["npm"]

						// "npm test" is longer than "npm", so it should be auto-approved
						expect(isAutoApprovedSingleCommand("npm test --coverage", allowedLong, deniedShort)).toBe(true)
					})
				})

				describe("isAutoDeniedSingleCommand", () => {
					it("auto-denies commands that match denylist but not allowlist", () => {
						expect(isAutoDeniedSingleCommand("npm test --coverage", allowedCommands, deniedCommands)).toBe(
							true,
						)
						expect(isAutoDeniedSingleCommand("git push origin main", allowedCommands, deniedCommands)).toBe(
							true,
						)
					})

					it("does not auto-deny commands that match allowlist", () => {
						expect(isAutoDeniedSingleCommand("npm install", allowedCommands, deniedCommands)).toBe(false)
						expect(isAutoDeniedSingleCommand("echo hello", allowedCommands, deniedCommands)).toBe(false)
						expect(isAutoDeniedSingleCommand("git status", allowedCommands, deniedCommands)).toBe(false)
					})

					it("does not auto-deny commands that match neither list", () => {
						expect(isAutoDeniedSingleCommand("dangerous", allowedCommands, deniedCommands)).toBe(false)
						expect(isAutoDeniedSingleCommand("rm -rf /", allowedCommands, deniedCommands)).toBe(false)
					})

					it("does not auto-deny when no denylist configured", () => {
						expect(isAutoDeniedSingleCommand("npm test", allowedCommands, [])).toBe(false)
						expect(isAutoDeniedSingleCommand("npm test", allowedCommands, undefined as any)).toBe(false)
					})

					it("uses longest prefix match rule for auto-denial", () => {
						const allowedShort = ["npm"]
						const deniedLong = ["npm test"]

						// "npm test" is longer than "npm", so it should be auto-denied
						expect(isAutoDeniedSingleCommand("npm test --coverage", allowedShort, deniedLong)).toBe(true)
					})

					it("auto-denies when denylist match is equal length to allowlist match", () => {
						const allowedEqual = ["npm test"]
						const deniedEqual = ["npm test"]

						// Equal length matches should result in auto-denial
						expect(isAutoDeniedSingleCommand("npm test --coverage", allowedEqual, deniedEqual)).toBe(true)
					})
				})

				describe("Three-tier behavior verification", () => {
					it("demonstrates the three-tier system", () => {
						const allowed = ["npm"]
						const denied = ["npm test"]

						// Auto-approved: matches allowlist, doesn't match denylist
						expect(isAutoApprovedSingleCommand("npm install", allowed, denied)).toBe(true)
						expect(isAutoDeniedSingleCommand("npm install", allowed, denied)).toBe(false)

						// Auto-denied: matches denylist with longer or equal match
						expect(isAutoApprovedSingleCommand("npm test --coverage", allowed, denied)).toBe(false)
						expect(isAutoDeniedSingleCommand("npm test --coverage", allowed, denied)).toBe(true)

						// Ask user: matches neither list
						expect(isAutoApprovedSingleCommand("dangerous", allowed, denied)).toBe(false)
						expect(isAutoDeniedSingleCommand("dangerous", allowed, denied)).toBe(false)

						// Ask user: no lists configured
						expect(isAutoApprovedSingleCommand("npm test", [], [])).toBe(false)
						expect(isAutoDeniedSingleCommand("npm test", [], [])).toBe(false)
					})
				})
			})

			describe("Command-level three-tier validation", () => {
				const allowedCommands = ["npm", "echo"]
				const deniedCommands = ["npm test"]

				describe("isAutoApprovedCommand", () => {
					it("auto-approves commands with all sub-commands auto-approved", () => {
						expect(isAutoApprovedCommand("npm install", allowedCommands, deniedCommands)).toBe(true)
						expect(isAutoApprovedCommand("npm install && echo done", allowedCommands, deniedCommands)).toBe(
							true,
						)
					})

					it("does not auto-approve commands with any sub-command not auto-approved", () => {
						expect(isAutoApprovedCommand("npm test", allowedCommands, deniedCommands)).toBe(false)
						expect(isAutoApprovedCommand("npm install && npm test", allowedCommands, deniedCommands)).toBe(
							false,
						)
					})

					it("blocks subshell commands only when denylist is present", () => {
						// Without denylist, should allow subshells
						expect(isAutoApprovedCommand("npm install $(echo test)", allowedCommands)).toBe(true)
						expect(isAutoApprovedCommand("npm install `echo test`", allowedCommands)).toBe(true)

						// With denylist, should block subshells
						expect(isAutoApprovedCommand("npm install $(echo test)", allowedCommands, deniedCommands)).toBe(
							false,
						)
						expect(isAutoApprovedCommand("npm install `echo test`", allowedCommands, deniedCommands)).toBe(
							false,
						)
					})
				})

				describe("isAutoDeniedCommand", () => {
					it("auto-denies commands with any sub-command auto-denied", () => {
						expect(isAutoDeniedCommand("npm test", allowedCommands, deniedCommands)).toBe(true)
						expect(isAutoDeniedCommand("npm install && npm test", allowedCommands, deniedCommands)).toBe(
							true,
						)
					})

					it("does not auto-deny commands with all sub-commands not auto-denied", () => {
						expect(isAutoDeniedCommand("npm install", allowedCommands, deniedCommands)).toBe(false)
						expect(isAutoDeniedCommand("npm install && echo done", allowedCommands, deniedCommands)).toBe(
							false,
						)
					})

					it("auto-denies subshell commands only when denylist is present", () => {
						// Without denylist, should not auto-deny subshells
						expect(isAutoDeniedCommand("npm install $(echo test)", allowedCommands)).toBe(false)
						expect(isAutoDeniedCommand("npm install `echo test`", allowedCommands)).toBe(false)

						// With denylist, should auto-deny subshells
						expect(isAutoDeniedCommand("npm install $(echo test)", allowedCommands, deniedCommands)).toBe(
							true,
						)
						expect(isAutoDeniedCommand("npm install `echo test`", allowedCommands, deniedCommands)).toBe(
							true,
						)
					})
				})
			})
		})
	})
})

describe("Unified Command Decision Functions", () => {
	describe("getSingleCommandDecision", () => {
		const allowedCommands = ["npm", "echo", "git"]
		const deniedCommands = ["npm test", "git push"]

		it("returns auto_approve for commands that match allowlist but not denylist", () => {
			expect(getSingleCommandDecision("npm install", allowedCommands, deniedCommands)).toBe("auto_approve")
			expect(getSingleCommandDecision("echo hello", allowedCommands, deniedCommands)).toBe("auto_approve")
			expect(getSingleCommandDecision("git status", allowedCommands, deniedCommands)).toBe("auto_approve")
		})

		it("returns auto_deny for commands that match denylist", () => {
			expect(getSingleCommandDecision("npm test --coverage", allowedCommands, deniedCommands)).toBe("auto_deny")
			expect(getSingleCommandDecision("git push origin main", allowedCommands, deniedCommands)).toBe("auto_deny")
		})

		it("returns ask_user for commands that match neither list", () => {
			expect(getSingleCommandDecision("dangerous", allowedCommands, deniedCommands)).toBe("ask_user")
			expect(getSingleCommandDecision("rm -rf /", allowedCommands, deniedCommands)).toBe("ask_user")
		})

		it("implements longest prefix match rule correctly", () => {
			const allowedLong = ["npm", "npm test"]
			const deniedShort = ["npm"]

			// "npm test" (8 chars) is longer than "npm" (3 chars), so allowlist wins
			expect(getSingleCommandDecision("npm test --coverage", allowedLong, deniedShort)).toBe("auto_approve")

			const allowedShort = ["npm"]
			const deniedLong = ["npm test"]

			// "npm test" (8 chars) is longer than "npm" (3 chars), so denylist wins
			expect(getSingleCommandDecision("npm test --coverage", allowedShort, deniedLong)).toBe("auto_deny")
		})

		it("handles equal length matches with denylist winning", () => {
			const allowedEqual = ["npm test"]
			const deniedEqual = ["npm test"]

			// Equal length - denylist wins (secure by default)
			expect(getSingleCommandDecision("npm test --coverage", allowedEqual, deniedEqual)).toBe("auto_deny")
		})

		it("handles wildcard patterns correctly", () => {
			const allowedWildcard = ["*"]
			const deniedSpecific = ["rm -rf"]

			// "*" (1 char) vs "rm -rf" (6 chars) - denylist wins for matching commands
			expect(getSingleCommandDecision("rm -rf /", allowedWildcard, deniedSpecific)).toBe("auto_deny")
			// Non-matching commands should be auto-approved by wildcard
			expect(getSingleCommandDecision("npm test", allowedWildcard, deniedSpecific)).toBe("auto_approve")
		})

		it("handles empty command", () => {
			expect(getSingleCommandDecision("", allowedCommands, deniedCommands)).toBe("auto_approve")
		})

		it("handles empty lists", () => {
			expect(getSingleCommandDecision("npm test", [], [])).toBe("ask_user")
			expect(getSingleCommandDecision("npm test", undefined as any, undefined as any)).toBe("ask_user")
		})
	})

	describe("getCommandDecision", () => {
		const allowedCommands = ["npm", "echo"]
		const deniedCommands = ["npm test"]

		it("returns auto_approve for commands with all sub-commands auto-approved", () => {
			expect(getCommandDecision("npm install", allowedCommands, deniedCommands)).toBe("auto_approve")
			expect(getCommandDecision("npm install && echo done", allowedCommands, deniedCommands)).toBe("auto_approve")
		})

		it("returns auto_deny for commands with any sub-command auto-denied", () => {
			expect(getCommandDecision("npm test", allowedCommands, deniedCommands)).toBe("auto_deny")
			expect(getCommandDecision("npm install && npm test", allowedCommands, deniedCommands)).toBe("auto_deny")
		})

		it("returns ask_user for commands with mixed or unknown sub-commands", () => {
			expect(getCommandDecision("dangerous", allowedCommands, deniedCommands)).toBe("ask_user")
			expect(getCommandDecision("npm install && dangerous", allowedCommands, deniedCommands)).toBe("ask_user")
		})

		it("returns auto_deny for subshell commands when denylist is present", () => {
			expect(getCommandDecision("npm install $(echo test)", allowedCommands, deniedCommands)).toBe("auto_deny")
			expect(getCommandDecision("npm install `echo test`", allowedCommands, deniedCommands)).toBe("auto_deny")
		})

		it("allows subshell commands when no denylist is present", () => {
			expect(getCommandDecision("npm install $(echo test)", allowedCommands)).toBe("auto_approve")
			expect(getCommandDecision("npm install `echo test`", allowedCommands)).toBe("auto_approve")
		})

		it("handles empty command", () => {
			expect(getCommandDecision("", allowedCommands, deniedCommands)).toBe("auto_approve")
		})

		it("handles complex chained commands", () => {
			// All sub-commands auto-approved
			expect(getCommandDecision("npm install && echo success && npm run build", ["npm", "echo"], [])).toBe(
				"auto_approve",
			)

			// One sub-command auto-denied
			expect(getCommandDecision("npm install && npm test && echo done", allowedCommands, deniedCommands)).toBe(
				"auto_deny",
			)

			// Mixed decisions (some ask_user)
			expect(getCommandDecision("npm install && dangerous && echo done", allowedCommands, deniedCommands)).toBe(
				"ask_user",
			)
		})

		it("demonstrates the three-tier system comprehensively", () => {
			const allowed = ["npm"]
			const denied = ["npm test"]

			// Auto-approved: all sub-commands match allowlist, none match denylist
			expect(getCommandDecision("npm install", allowed, denied)).toBe("auto_approve")
			expect(getCommandDecision("npm install && npm run build", allowed, denied)).toBe("auto_approve")

			// Auto-denied: any sub-command matches denylist
			expect(getCommandDecision("npm test", allowed, denied)).toBe("auto_deny")
			expect(getCommandDecision("npm install && npm test", allowed, denied)).toBe("auto_deny")

			// Ask user: commands that match neither list
			expect(getCommandDecision("dangerous", allowed, denied)).toBe("ask_user")
			expect(getCommandDecision("npm install && dangerous", allowed, denied)).toBe("ask_user")
		})
	})

	describe("Integration with existing functions", () => {
		it("maintains backward compatibility with existing behavior", () => {
			const allowedCommands = ["npm", "echo"]
			const deniedCommands = ["npm test"]

			// Test that new unified functions produce same results as old separate functions
			const testCommands = [
				"npm install", // should be auto-approved
				"npm test", // should be auto-denied
				"dangerous", // should ask user
				"echo hello", // should be auto-approved
			]

			testCommands.forEach((cmd) => {
				const decision = getCommandDecision(cmd, allowedCommands, deniedCommands)
				const oldApproved = isAutoApprovedCommand(cmd, allowedCommands, deniedCommands)
				const oldDenied = isAutoDeniedCommand(cmd, allowedCommands, deniedCommands)

				// Verify consistency
				if (decision === "auto_approve") {
					expect(oldApproved).toBe(true)
					expect(oldDenied).toBe(false)
				} else if (decision === "auto_deny") {
					expect(oldApproved).toBe(false)
					expect(oldDenied).toBe(true)
				} else if (decision === "ask_user") {
					expect(oldApproved).toBe(false)
					expect(oldDenied).toBe(false)
				}
			})
		})
	})

	describe("CommandValidator Integration Tests", () => {
		describe("CommandValidator Class", () => {
			let validator: CommandValidator

			beforeEach(() => {
				validator = new CommandValidator(["npm", "echo", "git"], ["npm test", "git push"])
			})

			describe("Basic validation methods", () => {
				it("validates commands correctly", () => {
					expect(validator.validateCommand("npm install")).toBe("auto_approve")
					expect(validator.validateCommand("npm test")).toBe("auto_deny")
					expect(validator.validateCommand("dangerous")).toBe("ask_user")
				})

				it("provides convenience methods", () => {
					expect(validator.isAutoApproved("npm install")).toBe(true)
					expect(validator.isAutoApproved("npm test")).toBe(false)
					expect(validator.isAutoApproved("dangerous")).toBe(false)

					expect(validator.isAutoDenied("npm install")).toBe(false)
					expect(validator.isAutoDenied("npm test")).toBe(true)
					expect(validator.isAutoDenied("dangerous")).toBe(false)

					expect(validator.requiresUserInput("npm install")).toBe(false)
					expect(validator.requiresUserInput("npm test")).toBe(false)
					expect(validator.requiresUserInput("dangerous")).toBe(true)
				})
			})

			describe("Configuration management", () => {
				it("updates command lists", () => {
					validator.updateCommandLists(["echo"], ["echo hello"])

					expect(validator.validateCommand("npm install")).toBe("ask_user")
					expect(validator.validateCommand("echo world")).toBe("auto_approve")
					expect(validator.validateCommand("echo hello")).toBe("auto_deny")
				})

				it("gets current command lists", () => {
					const lists = validator.getCommandLists()
					expect(lists.allowedCommands).toEqual(["npm", "echo", "git"])
					expect(lists.deniedCommands).toEqual(["npm test", "git push"])
				})

				it("handles undefined denied commands", () => {
					const validatorNoDeny = new CommandValidator(["npm"])
					const lists = validatorNoDeny.getCommandLists()
					expect(lists.allowedCommands).toEqual(["npm"])
					expect(lists.deniedCommands).toBeUndefined()
				})
			})

			describe("Detailed validation information", () => {
				it("provides comprehensive validation details", () => {
					const details = validator.getValidationDetails("npm install && echo done")

					expect(details.decision).toBe("auto_approve")
					expect(details.subCommands).toEqual(["npm install", "echo done"])
					expect(details.hasSubshells).toBe(false)
					expect(details.allowedMatches).toHaveLength(2)
					expect(details.deniedMatches).toHaveLength(2)

					// Check specific matches
					expect(details.allowedMatches[0]).toEqual({ command: "npm install", match: "npm" })
					expect(details.allowedMatches[1]).toEqual({ command: "echo done", match: "echo" })
					expect(details.deniedMatches[0]).toEqual({ command: "npm install", match: null })
					expect(details.deniedMatches[1]).toEqual({ command: "echo done", match: null })
				})

				it("detects subshells correctly", () => {
					const details = validator.getValidationDetails("npm install $(echo test)")
					expect(details.hasSubshells).toBe(true)
					expect(details.decision).toBe("auto_deny") // blocked due to subshells with denylist
				})

				it("handles complex command chains", () => {
					const details = validator.getValidationDetails("npm test && git push origin")

					expect(details.decision).toBe("auto_deny")
					expect(details.subCommands).toEqual(["npm test", "git push origin"])
					expect(details.deniedMatches[0]).toEqual({ command: "npm test", match: "npm test" })
					expect(details.deniedMatches[1]).toEqual({ command: "git push origin", match: "git push" })
				})
			})

			describe("Batch validation", () => {
				it("validates multiple commands at once", () => {
					const commands = ["npm install", "npm test", "dangerous", "echo hello"]
					const results = validator.validateCommands(commands)

					expect(results.get("npm install")).toBe("auto_approve")
					expect(results.get("npm test")).toBe("auto_deny")
					expect(results.get("dangerous")).toBe("ask_user")
					expect(results.get("echo hello")).toBe("auto_approve")
					expect(results.size).toBe(4)
				})

				it("handles empty command list", () => {
					const results = validator.validateCommands([])
					expect(results.size).toBe(0)
				})
			})

			describe("Configuration analysis", () => {
				it("detects if rules are configured", () => {
					expect(validator.hasRules()).toBe(true)

					const emptyValidator = new CommandValidator([], [])
					expect(emptyValidator.hasRules()).toBe(false)

					const allowOnlyValidator = new CommandValidator(["npm"], [])
					expect(allowOnlyValidator.hasRules()).toBe(true)

					const denyOnlyValidator = new CommandValidator([], ["rm"])
					expect(denyOnlyValidator.hasRules()).toBe(true)
				})

				it("provides configuration statistics", () => {
					const stats = validator.getStats()
					expect(stats.allowedCount).toBe(3)
					expect(stats.deniedCount).toBe(2)
					expect(stats.hasWildcard).toBe(false)
					expect(stats.hasRules).toBe(true)
				})

				it("detects wildcard configuration", () => {
					const wildcardValidator = new CommandValidator(["*", "npm"], ["rm"])
					const stats = wildcardValidator.getStats()
					expect(stats.hasWildcard).toBe(true)
				})
			})

			describe("Edge cases and error handling", () => {
				it("handles empty commands gracefully", () => {
					expect(validator.validateCommand("")).toBe("auto_approve")
					expect(validator.validateCommand("   ")).toBe("auto_approve")
				})

				it("handles commands with only whitespace", () => {
					const details = validator.getValidationDetails("   ")
					expect(details.decision).toBe("auto_approve")
					expect(details.subCommands).toEqual([])
				})

				it("handles malformed commands", () => {
					// Commands with unmatched quotes or brackets should not crash
					expect(() => validator.validateCommand('npm test "unclosed quote')).not.toThrow()
					expect(() => validator.validateCommand("npm test $(unclosed")).not.toThrow()
				})
			})
		})

		describe("Factory function", () => {
			it("creates validator instances correctly", () => {
				const validator = createCommandValidator(["npm"], ["rm"])
				expect(validator).toBeInstanceOf(CommandValidator)
				expect(validator.validateCommand("npm test")).toBe("auto_approve")
				expect(validator.validateCommand("rm file")).toBe("auto_deny")
			})

			it("handles optional denied commands", () => {
				const validator = createCommandValidator(["npm"])
				expect(validator.validateCommand("npm test")).toBe("auto_approve")
				expect(validator.validateCommand("dangerous")).toBe("ask_user")
			})
		})

		describe("Real-world integration scenarios", () => {
			describe("Development workflow validation", () => {
				let devValidator: CommandValidator

				beforeEach(() => {
					devValidator = createCommandValidator(
						["npm", "git", "echo", "ls", "cat"],
						["git push", "rm", "sudo", "npm publish"],
					)
				})

				it("allows common development commands", () => {
					const commonCommands = [
						"npm install",
						"npm test",
						"npm run build",
						"git status",
						"git add .",
						"git commit -m 'fix'",
						"echo 'done'",
						"ls -la",
						"cat package.json",
					]

					commonCommands.forEach((cmd) => {
						expect(devValidator.isAutoApproved(cmd)).toBe(true)
					})
				})

				it("blocks dangerous commands", () => {
					const dangerousCommands = [
						"git push origin main",
						"rm -rf node_modules",
						"sudo apt install",
						"npm publish",
					]

					dangerousCommands.forEach((cmd) => {
						expect(devValidator.isAutoDenied(cmd)).toBe(true)
					})
				})

				it("requires user input for unknown commands", () => {
					const unknownCommands = ["docker run", "python script.py", "curl https://api.example.com"]

					unknownCommands.forEach((cmd) => {
						expect(devValidator.requiresUserInput(cmd)).toBe(true)
					})
				})
			})

			describe("Production environment validation", () => {
				let prodValidator: CommandValidator

				beforeEach(() => {
					prodValidator = createCommandValidator(
						["ls", "cat", "grep", "tail"],
						["*"], // Deny everything by default
					)
				})

				it("allows only read-only commands", () => {
					expect(prodValidator.isAutoApproved("ls -la")).toBe(true)
					expect(prodValidator.isAutoApproved("cat /var/log/app.log")).toBe(true)
					expect(prodValidator.isAutoApproved("grep ERROR /var/log/app.log")).toBe(true)
					expect(prodValidator.isAutoApproved("tail -f /var/log/app.log")).toBe(true)
				})

				it("blocks all other commands due to wildcard deny", () => {
					const blockedCommands = ["npm install", "git push", "rm file", "echo hello", "mkdir test"]

					blockedCommands.forEach((cmd) => {
						expect(prodValidator.isAutoDenied(cmd)).toBe(true)
					})
				})
			})

			describe("Longest prefix match in complex scenarios", () => {
				let complexValidator: CommandValidator

				beforeEach(() => {
					complexValidator = createCommandValidator(
						["git", "git push", "git push --dry-run", "npm", "npm test"],
						["git push", "npm test --coverage"],
					)
				})

				it("demonstrates longest prefix match resolution", () => {
					// git push --dry-run (allowed, 18 chars) vs git push (denied, 8 chars) -> allow
					expect(complexValidator.isAutoApproved("git push --dry-run origin main")).toBe(true)

					// git push origin (denied, 8 chars) vs git (allowed, 3 chars) -> deny
					expect(complexValidator.isAutoDenied("git push origin main")).toBe(true)

					// npm test (allowed, 8 chars) vs npm test --coverage (denied, 19 chars) -> deny
					expect(complexValidator.isAutoDenied("npm test --coverage --watch")).toBe(true)

					// npm test basic (allowed, 8 chars) vs no deny match -> allow
					expect(complexValidator.isAutoApproved("npm test basic")).toBe(true)
				})

				it("handles command chains with mixed decisions", () => {
					// One command denied -> whole chain denied
					expect(complexValidator.isAutoDenied("git status && git push origin")).toBe(true)

					// All commands approved -> whole chain approved
					expect(complexValidator.isAutoApproved("git status && git push --dry-run")).toBe(true)

					// Mixed with unknown -> ask user
					expect(complexValidator.requiresUserInput("git status && unknown-command")).toBe(true)
				})
			})

			describe("Performance and scalability", () => {
				it("handles large command lists efficiently", () => {
					const largeAllowList = Array.from({ length: 1000 }, (_, i) => `command${i}`)
					const largeDenyList = Array.from({ length: 500 }, (_, i) => `dangerous${i}`)

					const largeValidator = createCommandValidator(largeAllowList, largeDenyList)

					// Should still work efficiently
					expect(largeValidator.isAutoApproved("command500 --flag")).toBe(true)
					expect(largeValidator.isAutoDenied("dangerous250 --flag")).toBe(true)
					expect(largeValidator.requiresUserInput("unknown")).toBe(true)
				})

				it("handles batch validation efficiently", () => {
					const batchValidator = createCommandValidator(["npm"], ["rm"])
					const commands = Array.from({ length: 100 }, (_, i) => `npm test${i}`)
					const results = batchValidator.validateCommands(commands)

					expect(results.size).toBe(100)
					// All should be auto-approved since they match "npm" allowlist
					Array.from(results.values()).forEach((decision) => {
						expect(decision).toBe("auto_approve")
					})
				})
			})
		})
	})
})
