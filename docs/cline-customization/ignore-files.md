# Controlling File Access with Ignore Files

Cline provides robust control over which files are accessible to the AI assistant through the use of ignore files. This document explains how to use this feature effectively to ensure your sensitive files remain private.

## Overview

Cline supports two types of ignore files:

1. **`.clineignore`**: The primary method for controlling file access in Cline
2. **`.gitignore`**: Automatically respected as a fallback when no `.clineignore` exists

These files use the standard ignore pattern syntax (same as `.gitignore`) to specify which files and directories should be inaccessible to the AI assistant.

## How It Works

When you create a `.clineignore` or `.gitignore` file in your workspace root, Cline will:

- Prevent the AI assistant from reading the contents of ignored files
- Block terminal commands that attempt to access ignored files
- Filter out ignored files from search results
- Mark ignored files with a 🔒 symbol in file listings

## Creating a `.clineignore` File

1. Create a file named `.clineignore` in the root directory of your workspace
2. Add patterns for files and directories you want to keep private
3. Save the file - Cline will automatically detect and apply the rules

## Pattern Syntax

The `.clineignore` file uses the same syntax as `.gitignore`:

- `file.txt` - Ignore a specific file
- `*.secret` - Ignore all files with the .secret extension
- `private/` - Ignore an entire directory and its contents
- `**/logs/` - Ignore all "logs" directories anywhere in the workspace
- `!important.txt` - Negation pattern: allow access to important.txt even if it matches another ignore pattern
- `# This is a comment` - Lines starting with # are comments

## Examples

### Basic `.clineignore` File

```
# Ignore sensitive files
.env
*.secret
credentials.json

# Ignore private directories
private/
.git/

# Ignore temporary files
*.tmp
*.log
```

### Advanced `.clineignore` with Negation Patterns

```
# Ignore all log files
*.log

# But allow access to important logs
!important.log
!logs/critical.log

# Ignore all files in the temp directory
temp/*

# But allow access to specific temp files
!temp/README.md
!temp/allowed/*
```

## Relationship with `.gitignore`

- If both `.clineignore` and `.gitignore` exist, `.clineignore` takes precedence
- If only `.gitignore` exists, Cline will use it to determine file access
- Patterns in `.clineignore` can override patterns in `.gitignore`

## Best Practices

1. **Start with sensitive data**: Always include files containing credentials, API keys, and personal information
2. **Include large directories**: Add directories like `node_modules/`, `dist/`, and other large directories that aren't relevant to your work
3. **Be specific**: Use precise patterns to avoid accidentally blocking access to important files
4. **Test your patterns**: Verify that your patterns work as expected by asking Cline to access various files
5. **Update as needed**: Modify your `.clineignore` file as your project evolves

## Troubleshooting

If you're experiencing issues with the ignore functionality:

1. **Check file location**: Ensure your `.clineignore` file is in the workspace root
2. **Verify syntax**: Make sure your patterns follow the correct syntax
3. **Path normalization**: Be aware that paths are normalized, so both forward and backslashes work
4. **Restart VS Code**: In rare cases, you may need to restart VS Code for changes to take effect

## Security Considerations

- Files outside your workspace are automatically inaccessible
- The `.clineignore` file itself is always inaccessible to Cline
- If an error occurs during validation, access is denied by default (fail-closed approach)
- Paths are normalized to prevent bypass attempts using different path formats

## Recent Improvements

The ignore file handling has been enhanced to ensure absolute reliability:

1. **Integrated `.gitignore` support**: Automatically respects `.gitignore` patterns when no `.clineignore` exists
2. **Improved path normalization**: Consistent handling of different path formats (forward/backslashes)
3. **Enhanced security**: Files outside the workspace are now blocked by default
4. **Better error handling**: Fail-closed approach ensures errors don't lead to unauthorized access
5. **Race condition protection**: Proper initialization sequence prevents timing issues
6. **Comprehensive validation**: Thorough checking of all file operations against ignore patterns

## Command-Line Access Control

Cline also validates terminal commands to prevent access to ignored files. Commands like `cat`, `less`, `grep`, and their PowerShell equivalents are checked to ensure they don't access ignored files.

## Conclusion

The ignore file functionality provides a powerful way to control which files Cline can access, helping you maintain privacy while working with the AI assistant. By creating a well-crafted `.clineignore` file, you can ensure that sensitive information remains private while still allowing Cline to assist you effectively with your coding tasks. 