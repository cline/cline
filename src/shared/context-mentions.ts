/*
- **Regex Breakdown**:

  1. **Pattern Components**:
     - The regex is built from multiple patterns joined with OR (|) operators
     - Each pattern handles a specific type of mention:
       - Unix/Linux paths
       - Windows paths with drive letters
       - Windows relative paths
       - Windows network shares
       - URLs with protocols
       - Git commit hashes
       - Special keywords (problems, git-changes, terminal)

  2. **Unix Path Pattern**:
     - `(?:\\/|^)`: Starts with a forward slash or beginning of line
     - `(?:[^\\/\\s\\\\]|\\\\[ \\t])+`: Path segment that can include escaped spaces
     - `(?:\\/(?:[^\\/\\s\\\\]|\\\\[ \\t])+)*`: Additional path segments after slashes
     - `\\/?`: Optional trailing slash

  3. **Windows Path Pattern**:
     - `[A-Za-z]:\\\\`: Drive letter followed by colon and double backslash
     - `(?:(?:[^\\\\\\s/]+|\\/[ ])+`: Path segment that can include spaces escaped with forward slash
     - `(?:\\\\(?:[^\\\\\\s/]+|\\/[ ])+)*)?`: Additional path segments after backslashes

  4. **Windows Relative Path Pattern**:
     - `(?:\\.{0,2}|[^\\\\\\s/]+)`: Path prefix that can be:
       - Current directory (.)
       - Parent directory (..)
       - Any directory name not containing spaces, backslashes, or forward slashes
     - `\\\\`: Backslash separator
     - `(?:[^\\\\\\s/]+|\\\\[ \\t]|\\/[ ])+`: Path segment that can include spaces escaped with backslash or forward slash
     - `(?:\\\\(?:[^\\\\\\s/]+|\\\\[ \\t]|\\/[ ])+)*`: Additional path segments after backslashes
     - `\\\\?`: Optional trailing backslash

  5. **Network Share Pattern**:
     - `\\\\\\\\`: Double backslash (escaped) to start network path
     - `[^\\\\\\s]+`: Server name
     - `(?:\\\\(?:[^\\\\\\s/]+|\\/[ ])+)*`: Share name and additional path components
     - `(?:\\\\)?`: Optional trailing backslash

  6. **URL Pattern**:
     - `\\w+:\/\/`: Protocol (http://, https://, etc.)
     - `[^\\s]+`: Rest of the URL (non-whitespace characters)

  7. **Git Hash Pattern**:
     - `[a-zA-Z0-9]{7,40}\\b`: 7-40 alphanumeric characters followed by word boundary

  8. **Special Keywords Pattern**:
     - `problems\\b`, `git-changes\\b`, `terminal\\b`: Exact word matches with word boundaries

  9. **Termination Logic**:
     - `(?=[.,;:!?]?(?=[\\s\\r\\n]|$))`: Positive lookahead that:
       - Allows an optional punctuation mark after the mention
       - Ensures the mention (and optional punctuation) is followed by whitespace or end of string

- **Behavior Summary**:
  - Matches @-prefixed mentions
  - Handles different path formats across operating systems
  - Supports escaped spaces in paths using OS-appropriate conventions
  - Cleanly terminates at whitespace or end of string
  - Excludes trailing punctuation from the match
  - Creates both single-match and global-match regex objects
*/

const mentionPatterns = [
	// Unix paths with escaped spaces using backslash
	"(?:\\/|^)(?:[^\\/\\s\\\\]|\\\\[ \\t])+(?:\\/(?:[^\\/\\s\\\\]|\\\\[ \\t])+)*\\/?",
	// Windows paths with drive letters (C:\path) with support for escaped spaces using forward slash
	"[A-Za-z]:\\\\(?:(?:[^\\\\\\s/]+|\\/[ ])+(?:\\\\(?:[^\\\\\\s/]+|\\/[ ])+)*)?",
	// Windows relative paths (folder\file or .\folder\file) with support for escaped spaces
	"(?:\\.{0,2}|[^\\\\\\s/]+)\\\\(?:[^\\\\\\s/]+|\\\\[ \\t]|\\/[ ])+(?:\\\\(?:[^\\\\\\s/]+|\\\\[ \\t]|\\/[ ])+)*\\\\?",
	// Windows network shares (\\server\share) with support for escaped spaces using forward slash
	"\\\\\\\\[^\\\\\\s]+(?:\\\\(?:[^\\\\\\s/]+|\\/[ ])+)*(?:\\\\)?",
	// URLs with protocols (http://, https://, etc.)
	"\\w+:\/\/[^\\s]+",
	// Git hashes (7-40 alphanumeric characters)
	"[a-zA-Z0-9]{7,40}\\b",
	// Special keywords
	"problems\\b",
	"git-changes\\b",
	"terminal\\b",
]
// Build the full regex pattern by joining the patterns with OR operator
const mentionRegexPattern = `@(${mentionPatterns.join("|")})(?=[.,;:!?]?(?=[\\s\\r\\n]|$))`
export const mentionRegex = new RegExp(mentionRegexPattern)
export const mentionRegexGlobal = new RegExp(mentionRegexPattern, "g")

export interface MentionSuggestion {
	type: "file" | "folder" | "git" | "problems"
	label: string
	description?: string
	value: string
	icon?: string
}

export interface GitMentionSuggestion extends MentionSuggestion {
	type: "git"
	hash: string
	shortHash: string
	subject: string
	author: string
	date: string
}

export function formatGitSuggestion(commit: {
	hash: string
	shortHash: string
	subject: string
	author: string
	date: string
}): GitMentionSuggestion {
	return {
		type: "git",
		label: commit.subject,
		description: `${commit.shortHash} by ${commit.author} on ${commit.date}`,
		value: commit.hash,
		icon: "$(git-commit)", // VSCode git commit icon
		hash: commit.hash,
		shortHash: commit.shortHash,
		subject: commit.subject,
		author: commit.author,
		date: commit.date,
	}
}
