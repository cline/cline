/*
Mention regex:
- **Purpose**: 
  - To identify and highlight specific mentions in text that start with '@'. 
  - These mentions can be file paths, URLs, or the exact word 'problems'.
  - Ensures that trailing punctuation marks (like commas, periods, etc.) are not included in the match, allowing punctuation to follow the mention without being part of it.

- **Regex Breakdown**:
  - `/@`: 
	- **@**: The mention must start with the '@' symbol.
  
  - `((?:\/|\w+:\/\/)[^\s]+?|problems\b)`:
	- **Capturing Group (`(...)`)**: Captures the part of the string that matches one of the specified patterns.
	- `(?:\/|\w+:\/\/)`: 
	  - **Non-Capturing Group (`(?:...)`)**: Groups the alternatives without capturing them for back-referencing.
	  - `\/`: 
		- **Slash (`/`)**: Indicates that the mention is a file or folder path starting with a '/'.
	  - `|`: Logical OR.
	  - `\w+:\/\/`: 
		- **Protocol (`\w+://`)**: Matches URLs that start with a word character sequence followed by '://', such as 'http://', 'https://', 'ftp://', etc.
	- `[^\s]+?`: 
	  - **Non-Whitespace Characters (`[^\s]+`)**: Matches one or more characters that are not whitespace.
	  - **Non-Greedy (`+?`)**: Ensures the smallest possible match, preventing the inclusion of trailing punctuation.
	- `|`: Logical OR.
	- `problems\b`: 
      - **Exact Word ('problems')**: Matches the exact word 'problems'.
      - **Word Boundary (`\b`)**: Ensures that 'problems' is matched as a whole word and not as part of another word (e.g., 'problematic').
    - `terminal\b`:
      - **Exact Word ('terminal')**: Matches the exact word 'terminal'.
      - **Word Boundary (`\b`)**: Ensures that 'terminal' is matched as a whole word and not as part of another word (e.g., 'terminals').

  - `(?=[.,;:!?()]*(?=[\s\r\n]|$))`:
	- **Positive Lookahead (`(?=...)`)**: Ensures that the match is followed by specific patterns without including them in the match.
	- `[.,;:!?()]*`: 
	  - **Optional Punctuation (`[.,;:!?()]*`)**: Matches zero or more of the specified punctuation marks (including parentheses).
	- `(?=[\s\r\n]|$)`: 
	  - **Nested Positive Lookahead (`(?=[\s\r\n]|$)`)**: Ensures that the punctuation (if present) is followed by a whitespace character, a line break, or the end of the string.
  
- **Summary**:
  - The regex effectively matches:
	- Mentions that are file or folder paths starting with '/' and containing any non-whitespace characters (including periods within the path).
	- URLs that start with a protocol (like 'http://') followed by any non-whitespace characters (including query parameters).
	- The exact word 'problems'.
  - The exact word 'terminal'.
	- The exact word 'git-changes'.
  - It ensures that any trailing punctuation marks (such as ',', '.', '!', etc.) are not included in the matched mention, allowing the punctuation to follow the mention naturally in the text.

- **Global Regex**:
  - `mentionRegexGlobal`: Creates a global version of the `mentionRegex` to find all matches within a given string.

*/
export const mentionRegex = new RegExp(
	`@(` +
		`[\\w-]+:/[^\\s]*?` + // Workspace-prefixed file paths: @workspace:name/path
		`|[\\w-]+:"\\/[^"]*?"` + // Workspace-prefixed quoted file paths
		`|/[^\\s]*?` + // Simple file paths (can't contain)
		`|"\\/[^"]*?"` + // Quoted file paths which can contain spaces
		`|(?:\\w+:\\/\\/)[^\\s]+?` + // URLs
		`|[a-f0-9]{7,40}\\b` + // Git commit hashes
		`|problems\\b` + // Exact word 'problems'
		`|terminal\\b` + // Exact word 'terminal'
		`|git-changes\\b` + // Exact word 'git-changes'
		`)` +
		`(?=[.,;:!?()]*(?=[\\s\\r\\n]|$))`, // Lookahead for trailing punctuation (multiple allowed)
)
export const mentionRegexGlobal = new RegExp(mentionRegex.source, "g")
