import { describe, expect, it } from "vitest"
import { formatCommandForTerminal } from "./vscode-run-commands-tool"

describe("formatCommandForTerminal", () => {
	it.each([
		{
			name: "raw shell command",
			input: "which git",
			expected: "which git",
		},
		{
			name: "raw shell command with pipes and quotes",
			input: "git status --short | sed -n '1,20p'",
			expected: "git status --short | sed -n '1,20p'",
		},
		{
			name: "structured command with omitted args",
			input: { command: "which git" },
			expected: "which git",
		},
		{
			name: "structured shell command with omitted args and metacharacters",
			input: { command: "git status --short | head -20" },
			expected: "git status --short | head -20",
		},
		{
			name: "structured executable with explicit empty args",
			input: { command: "/tmp/path with spaces/tool", args: [] },
			expected: "'/tmp/path with spaces/tool'",
		},
		{
			name: "structured executable with simple args",
			input: { command: "which", args: ["git"] },
			expected: "which git",
		},
		{
			name: "structured executable with spaced args",
			input: { command: "echo", args: ["hello world", "again"] },
			expected: "echo 'hello world' again",
		},
		{
			name: "structured executable with apostrophe args",
			input: { command: "printf", args: ["it's ok"] },
			expected: "printf 'it'\\''s ok'",
		},
		{
			name: "structured executable with empty arg",
			input: { command: "printf", args: [""] },
			expected: "printf ''",
		},
		{
			name: "structured executable with shell metacharacters in args",
			input: { command: "echo", args: ["$HOME", "a&b", "semi;colon", "paren(value)"] },
			expected: "echo '$HOME' 'a&b' 'semi;colon' 'paren(value)'",
		},
		{
			name: "structured executable with quoted args",
			input: { command: "node", args: ["-e", 'console.log("hi")'] },
			expected: "node -e 'console.log(\"hi\")'",
		},
	])("$name", ({ input, expected }) => {
		expect(formatCommandForTerminal(input)).toBe(expected)
	})

	it("quotes multiple structured args that need shell escaping", () => {
		expect(formatCommandForTerminal({ command: "echo", args: ["hello world", "it's ok"] })).toBe(
			"echo 'hello world' 'it'\\''s ok'",
		)
	})
})
