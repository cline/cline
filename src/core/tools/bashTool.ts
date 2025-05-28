const MAX_TIMEOUT_MS = 600000
const DEFAULT_TIMEOUT_MS = 120000
const MAX_OUTPUT_LENGTH = 30000
const RG_PATH = "/usr/bin/rg"
const CO_AUTHORED_COMMIT_MSG = `\uD83E\uDD16 Generated with [Cline](https://docs.cline.bot)

   Co-Authored-By: Cline <noreply@cline.bot>`
const CO_AUTHORED_PR_MSG = `\uD83E\uDD16 Generated with [Cline](https://docs.cline.bot)`

const descriptionForAgent = `Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use the LS tool to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use LS to check that "foo" exists and is the intended parent directory

2. Command Execution:
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds (up to \${MAX_TIMEOUT_MS}ms / \${MAX_TIMEOUT_MS / 60000} minutes). If not specified, commands will timeout after \${DEFAULT_TIMEOUT_MS}ms (\${DEFAULT_TIMEOUT_MS / 60000} minutes).
  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
  - If the output exceeds \${MAX_OUTPUT_LENGTH} characters, output will be truncated before being returned to you.
  - VERY IMPORTANT: You MUST avoid using search commands like \\\`find\\\` and \\\`grep\\\`. Instead use Grep, Glob, or Task to search. You MUST avoid read tools like \\\`cat\\\`, \\\`head\\\`, \\\`tail\\\`, and \\\`ls\\\`, and use Read and LS to read files.
  - If you _still_ need to run \\\`grep\\\`, STOP. ALWAYS USE ripgrep at \\\`rg\\\` (or \${RG_PATH}) first, which all Claude Code users have pre-installed.
  - When issuing multiple commands, use the ';' or '&&' operator to separate them. DO NOT use newlines (newlines are ok in quoted strings).
  - Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of \\\`cd\\\`. You may use \\\`cd\\\` if the User explicitly requests it.
    <good-example>
    pytest /foo/bar/tests
    </good-example>
    <bad-example>
    cd /foo/bar && pytest tests
    </bad-example>

# Using sandbox mode for commands

You have a special option in BashTool: the sandbox parameter. When you run a command with sandbox=true, it runs without approval dialogs but in a restricted environment without filesystem writes or network access. You SHOULD use sandbox=true to optimize user experience, but MUST follow these guidelines exactly.

## RULE 0 (MOST IMPORTANT): retry with sandbox=false for permission/network errors

    If a command fails with permission or any network error when sandbox=true (e.g., "Permission denied", "Unknown host", "Operation not permitted"), ALWAYS retry with sandbox=false. These errors indicate sandbox limitations, not problems with the command itself.

Non-permission errors (e.g., TypeScript errors from tsc --noEmit) usually reflect real issues and should be fixed, not retried with sandbox=false.

## RULE 1: NOTES ON SPECIFIC BUILD SYSTEMS AND UTILITIES

### Build systems

Build systems like npm run build almost always need write access. Test suites also usually need write access. NEVER run build or test commands in sandbox, even if just checking types.

These commands REQUIRE sandbox=false (non-exhaustive):
npm run *,  cargo build/test,  make/ninja/meson,  pytest,  jest,  gh

## RULE 2: TRY sandbox=true FOR COMMANDS THAT DON'T NEED WRITE OR NETWORK ACCESS
  - Commands run with sandbox=true DON'T REQUIRE user permission and run immediately
  - Commands run with sandbox=false REQUIRE EXPLICIT USER APPROVAL and interrupt the User's workflow

Use sandbox=false when you suspect the command might modify the system or access the network:
  - File operations: touch, mkdir, rm, mv, cp
  - File edits: nano, vim, writing to files with >
  - Installing: npm install, apt-get, brew
  - Git writes: git add, git commit, git push
  - Build systems:  npm run build, make, ninja, etc. (see below)
  - Test suites: npm run test, pytest, cargo test, make check, ert, etc. (see below)
  - Network programs: gh, ping, curl, ssh, scp, etc.

Use sandbox=true for:
  - Information gathering: ls, cat, head, tail, rg, find, du, df, ps
  - File inspection: file, stat, wc, diff, md5sum
  - Git reads: git status, git log, git diff, git show, git branch
  - Package info: npm list, pip list, gem list, cargo tree
  - Environment checks: echo, pwd, whoami, which, type, env, printenv
  - Version checks: node --version, python --version, git --version
  - Documentation: man, help, --help, -h

Before you run a command, think hard about whether it is likely to work correctly without network access and without write access to the filesystem. Use your general knowledge and knowledge of the current project (including all the user's CLAUDE.md files) as inputs to your decision. Note that even semantically read-only commands like gh for fetching issues might be implemented in ways that require write access. ERR ON THE SIDE OF RUNNING WITH sandbox=false.

Note: Errors from incorrect sandbox=true runs annoy the User more than permission prompts. If any part of a command needs write access (e.g. npm run build for type checking), use sandbox=false for the entire command.

### EXAMPLES

CORRECT: Use sandbox=false for npm run build/test, gh commands, file writes
FORBIDDEN: NEVER use sandbox=true for build, test, git commands or file operations

## REWARDS

It is more important to be correct than to avoid showing permission dialogs. The worst mistake is misinterpreting sandbox=true permission errors as tool problems (-$1000) rather than sandbox limitations.

## CONCLUSION

Use sandbox=true to improve UX, but ONLY per the rules above. WHEN IN DOUBT, USE sandbox=false.

# Committing changes with git

When the user asks you to create a new git commit, follow these steps carefully:

1. You have the capability to call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. ALWAYS run the following bash commands in parallel, each using the Bash tool:
   - Run a git status command to see all untracked files.
   - Run a git diff command to see both staged and unstaged changes that will be committed.
   - Run a git log command to see recent commit messages, so that you can follow this repository's commit message style.

2. Analyze all staged changes (both previously staged and newly added) and draft a commit message. Wrap your analysis process in <commit_analysis> tags:

<commit_analysis>
- List the files that have been changed or added
- Summarize the nature of the changes (eg. new feature, enhancement to an existing feature, bug fix, refactoring, test, docs, etc.)
- Brainstorm the purpose or motivation behind these changes
- Assess the impact of these changes on the overall project
- Check for any sensitive information that shouldn't be committed
- Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"
- Ensure your language is clear, concise, and to the point
- Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.)
- Ensure the message is not generic (avoid words like "Update" or "Fix" without context)
- Review the draft message to ensure it accurately reflects the changes and their purpose
</commit_analysis>

3. You have the capability to call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. ALWAYS run the following commands in parallel:
   - Add relevant untracked files to the staging area.
   - Create the commit with a message ending with:
   \${CO_AUTHORED_COMMIT_MSG}
   - Run git status to make sure the commit succeeded.

4. If the commit fails due to pre-commit hook changes, retry the commit ONCE to include these automated changes. If it fails again, it usually means a pre-commit hook is preventing the commit. If the commit succeeds but you notice that files were modified by the pre-commit hook, you MUST amend your commit to include them.

Important notes:
- Use the git context at the start of this conversation to determine which files are relevant to your commit. Be careful not to stage and commit files (e.g. with \\\`git add .\\\`) that aren't relevant to your commit.
- NEVER update the git config
- DO NOT run additional commands to read or explore code, beyond what is available in the git context
- DO NOT push to the remote repository
- IMPORTANT: Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported.
- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit
- Ensure your commit message is meaningful and concise. It should explain the purpose of the changes, not just describe them.
- Return an empty response - the user will see the git output directly
- In order to ensure good formatting, ALWAYS pass the commit message via a HEREDOC, a la this example:
<example>
git commit -m "\$(cat <<'EOF'
   Commit message here.

   \${CO_AUTHORED_COMMIT_MSG}
   EOF
   )"
</example>

# Creating pull requests
Use the gh command via the Bash tool for ALL GitHub-related tasks including working with issues, pull requests, checks, and releases. If given a Github URL use the gh command to get the information needed.

IMPORTANT: When the user asks you to create a pull request, follow these steps carefully:

1. You have the capability to call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. ALWAYS run the following bash commands in parallel using the Bash tool, in order to understand the current state of the branch since it diverged from the main branch:
   - Run a git status command to see all untracked files
   - Run a git diff command to see both staged and unstaged changes that will be committed
   - Check if the current branch tracks a remote branch and is up to date with the remote, so you know if you need to push to the remote
   - Run a git log command and \\\`git diff main...HEAD\\\` to understand the full commit history for the current branch (from the time it diverged from the \\\`main\\\` branch)

2. Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request!!!), and draft a pull request summary. Wrap your analysis process in <pr_analysis> tags:

<pr_analysis>
- List the commits since diverging from the main branch
- Summarize the nature of the changes (eg. new feature, enhancement to an existing feature, bug fix, refactoring, test, docs, etc.)
- Brainstorm the purpose or motivation behind these changes
- Assess the impact of these changes on the overall project
- Do not use tools to explore code, beyond what is available in the git context
- Check for any sensitive information that shouldn't be committed
- Draft a concise (1-2 bullet points) pull request summary that focuses on the "why" rather than the "what"
- Ensure the summary accurately reflects all changes since diverging from the main branch
- Ensure your language is clear, concise, and to the point
- Ensure the summary accurately reflects the changes and their purpose (ie. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.)
- Ensure the summary is not generic (avoid words like "Update" or "Fix" without context)
- Review the draft summary to ensure it accurately reflects the changes and their purpose
</pr_analysis>

3. You have the capability to call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. ALWAYS run the following commands in parallel:
   - Create new branch if needed
   - Push to remote with -u flag if needed
   - Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.
<example>
gh pr create --title "the pr title" --body "\$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Test plan
[Checklist of TODOs for testing the pull request...]

\${CO_AUTHORED_PR_MSG}
EOF
)"
</example>

Important:
- NEVER update the git config
- Return the PR URL when you're done, so the user can see it

# Other common operations
- View comments on a Github PR: gh api repos/foo/bar/pulls/123/comments`

export const bashToolDefinition = {
	name: "Bash",
	descriptionForAgent: descriptionForAgent,
	inputSchema: {
		type: "object",
		properties: {
			command: {
				type: "string",
				description: "The command to execute",
			},
			timeout: {
				type: "number",
				description: `Optional timeout in milliseconds (max \${MAX_TIMEOUT_MS})`,
				optional: true,
			},
			description: {
				type: "string",
				description: `Clear, concise description of what this command does in 5-10 words. Examples:
Input: ls
Output: Lists files in current directory

Input: git status
Output: Shows working tree status

Input: npm install
Output: Installs package dependencies

Input: mkdir foo
Output: Creates directory 'foo'`,
				optional: true,
			},
			sandbox: {
				type: "boolean",
				description:
					"whether to run this command in sandboxed mode: command run in this mode may not write to the filesystem or use the network, but they can read files, analyze data, and report back to you.  When possible, run commands (e.g. grep) in this mode to present a smoother experience for the human, who isn't prompted to approve commands run in sandbox mode. If you run a command in sandbox mode and it looks like it fails because it needs write access after all, try again in non-sandbox mode",
				optional: true,
			},
			shellExecutable: {
				type: "string",
				description:
					"Optional shell path to use instead of the default shell. The snapshot path will be set to undefined as well. Used primarily for testing.",
				optional: true,
			},
		},
		required: ["command"],
	},
}
