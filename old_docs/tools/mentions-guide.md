# Cline Mentions Feature Guide

## Overview

The mentions feature is a powerful capability that allows you to reference various resources in your conversations with Cline using the "@" symbol. This includes file contents, directory structures, webpage URLs, VSCode diagnostic information, terminal output, Git change status, and more - all easily incorporated into your conversations.

By using this feature, Cline can gain more accurate context and provide more relevant assistance for your tasks.

## Basic Syntax

Mentions always start with the "@" symbol, followed by the path or identifier of the resource you want to reference:

```
@resource_identifier
```

You can place mentions anywhere in your user messages, and Cline will automatically retrieve the referenced content.

## Supported Mention Types

### 1. File References

To reference file contents, use `@/` followed by the relative path within your project:

```
@/path/to/file.js
```

**Example:**
```
Please analyze the implementation in @/src/components/Button.tsx
```

In this example, Cline automatically retrieves the contents of Button.tsx and uses it to perform the analysis.

### 2. Directory References

To reference directory contents, use `@/` followed by the relative path of the directory, ending with a trailing `/`:

```
@/path/to/directory/
```

**Example:**
```
What components are available in the @/src/components/ directory?
```

In this example, Cline retrieves a listing of the components directory and its contents.

### 3. URL References

To reference web page contents, use `@` followed by the URL:

```
@https://example.com
```

**Example:**
```
Please parse the JSON response from @https://api.github.com/users/octocat
```

In this example, Cline fetches the response from the GitHub API and analyzes the JSON.

### 4. Diagnostic References

To reference VSCode diagnostic information (errors and warnings) in the current workspace, use `@problems`:

```
@problems
```

**Example:**
```
Check @problems and tell me which errors I should prioritize fixing
```

In this example, Cline retrieves the current errors and warnings from your workspace and identifies high-priority issues.

### 5. Terminal Output References

To reference the latest terminal output, use `@terminal`:

```
@terminal
```

**Example:**
```
Please identify the cause of the error in the @terminal output
```

In this example, Cline examines the latest terminal output and analyzes the error's cause.

### 6. Git Working Directory References

To reference the current Git working directory change status, use `@git-changes`:

```
@git-changes
```

**Example:**
```
Review the @git-changes and summarize the important changes that should be committed
```

In this example, Cline retrieves the list of changed files in the current Git working directory and identifies candidates for commit.

### 7. Git Commit References

To reference information about a specific Git commit, use `@` followed by the commit hash:

```
@commit_hash
```

**Example:**
```
Analyze the commit @abcd123 and explain what changes were made
```

In this example, Cline retrieves information about the specified commit hash and analyzes the changes made in that commit.

## Usage Scenarios

### Code Review

```
Check @/src/components/Form.jsx and suggest improvements from a performance perspective. Also, if there are any @problems, please suggest how to fix them.
```

### Debugging Assistance

```
My npm install failed. Please examine the @terminal output and suggest a solution to the problem.
```

### Project Analysis

```
Analyze the code in the @/src/models/ directory and explain the relationships between the data models. Also, tell me how the utility functions in @/src/utils/ are used with these models.
```

### Code Generation

```
Create a new Input.tsx component using the same design language as @/src/components/Button.tsx
```

### Version Control Integration

```
Review the @git-changes and suggest a commit message for the feature I'm working on.
```

## Combining Multiple Mentions

You can combine multiple mentions to provide more complex context:

```
There seems to be a bug in @/src/api/users.js. Please check @problems and @terminal to identify and fix the issue.
```

## Limitations and Considerations

1. **Large Files**: Referencing very large files may take time to process and could consume a significant amount of tokens.

2. **Binary Files**: Binary files (such as images) will not be properly processed and will show a "Binary file" message.

3. **Directory Structure**: Directory references will only show top-level files and directories, not recursively showing the contents of subdirectories.

4. **URL Limitations**: Some websites may block automated crawling, which could prevent accurate content retrieval.

5. **Path Syntax**: File paths or URLs with special characters (such as spaces) may not be recognized correctly.

## Troubleshooting

### Mentions Not Recognized

If your mentions aren't being recognized correctly, check that:

- There's no space after the `@` symbol
- File paths are accurate (case-sensitive)
- URLs include the full format (with `https://`)

### Content Not Retrieved

If the content of referenced resources can't be retrieved:

- Verify the file exists
- Ensure you have access permissions for the file
- Check that the file isn't too large or the URL too complex

### Performance Issues

If mention processing is slow:

- Reference smaller files or specific file sections
- Reduce the number of mentions used at once

## Conclusion

Mastering the mentions feature makes your communication with Cline more efficient. By providing appropriate context, Cline can deliver more accurate assistance, significantly improving your development workflow.
