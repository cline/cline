import { exec, execFile } from "child_process"
import { promisify } from "util"
import { Logger } from "@/shared/services/Logger"

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)
const GIT_OUTPUT_LINE_LIMIT = 500

// A human-readable label for the returned output header, not a runnable command
// (each untracked file is diffed separately against /dev/null).
const UNTRACKED_DIFF_LABEL = "git diff --no-index (untracked files)"

export interface GitCommit {
	hash: string
	shortHash: string
	subject: string
	author: string
	date: string
}

async function checkGitRepo(cwd: string): Promise<boolean> {
	try {
		await execAsync("git rev-parse --git-dir", { cwd })
		return true
	} catch (_error) {
		return false
	}
}

async function checkGitInstalled(): Promise<boolean> {
	try {
		await execAsync("git --version")
		return true
	} catch (_error) {
		return false
	}
}

async function checkGitRepoHasCommits(cwd: string): Promise<boolean> {
	try {
		await execAsync("git rev-parse HEAD", { cwd })
		return true
	} catch (_error) {
		return false
	}
}

export async function searchCommits(query: string, cwd: string): Promise<GitCommit[]> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			Logger.error("Git is not installed")
			return []
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			Logger.error("Not a git repository")
			return []
		}

		// Check if repo has any commits
		if (!(await checkGitRepoHasCommits(cwd))) {
			// No commits yet in the repository
			return []
		}

		// Search commits by hash or message, limiting to 10 results
		const { stdout } = await execAsync(
			`git log -n 10 --format="%H%n%h%n%s%n%an%n%ad" --date=short ` + `--grep="${query}" --regexp-ignore-case`,
			{ cwd },
		)

		let output = stdout
		if (!output.trim() && /^[a-f0-9]+$/i.test(query)) {
			// If no results from grep search and query looks like a hash, try searching by hash
			const { stdout: hashStdout } = await execAsync(
				`git log -n 10 --format="%H%n%h%n%s%n%an%n%ad" --date=short ` + `--author-date-order ${query}`,
				{ cwd },
			).catch(() => ({ stdout: "" }))

			if (!hashStdout.trim()) {
				return []
			}

			output = hashStdout
		}

		const commits: GitCommit[] = []
		const lines = output
			.trim()
			.split("\n")
			.filter((line) => line !== "--")

		for (let i = 0; i < lines.length; i += 5) {
			commits.push({
				hash: lines[i],
				shortHash: lines[i + 1],
				subject: lines[i + 2],
				author: lines[i + 3],
				date: lines[i + 4],
			})
		}

		return commits
	} catch (error) {
		Logger.error("Error searching commits:", error)
		return []
	}
}

export async function getCommitInfo(hash: string, cwd: string): Promise<string> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return "Git is not installed"
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return "Not a git repository"
		}

		// Check if repo has any commits
		if (!(await checkGitRepoHasCommits(cwd))) {
			return "Repository has no commits yet"
		}

		// Get commit info, stats, and diff separately
		const { stdout: info } = await execAsync(`git show --format="%H%n%h%n%s%n%an%n%ad%n%b" --no-patch ${hash}`, {
			cwd,
		})
		const [fullHash, shortHash, subject, author, date, body] = info.trim().split("\n")

		const { stdout: stats } = await execAsync(`git show --stat --format="" ${hash}`, { cwd })

		const { stdout: diff } = await execAsync(`git show --format="" ${hash}`, { cwd })

		const summary = [
			`Commit: ${shortHash} (${fullHash})`,
			`Author: ${author}`,
			`Date: ${date}`,
			`\nMessage: ${subject}`,
			body ? `\nDescription:\n${body}` : "",
			"\nFiles Changed:",
			stats.trim(),
			"\nFull Changes:",
		].join("\n")

		const output = summary + "\n\n" + diff.trim()
		return truncateOutput(output)
	} catch (error) {
		Logger.error("Error getting commit info:", error)
		return `Failed to get commit info: ${error instanceof Error ? error.message : String(error)}`
	}
}

export async function getWorkingState(cwd: string): Promise<string> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return "Git is not installed"
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return "Not a git repository"
		}

		// Get status of working directory
		const { stdout: status } = await execAsync("git status --short", { cwd })
		if (!status.trim()) {
			return "No changes in working directory"
		}

		// Check if repo has any commits before trying to diff against HEAD
		let diff = ""
		if (await checkGitRepoHasCommits(cwd)) {
			// Only run git diff if there are commits
			const { stdout: diffOutput } = await execAsync("git diff HEAD", { cwd })
			diff = diffOutput
		} else {
			// No commits yet, use status output only
			return `Working directory changes (new repository):\n\n${status}`
		}
		const output = `Working directory changes:\n\n${status}\n\n${diff}`.trim()
		return truncateOutput(output)
	} catch (error) {
		Logger.error("Error getting working state:", error)
		return `Failed to get working state: ${error instanceof Error ? error.message : String(error)}`
	}
}

export async function getGitDiff(cwd: string, stagedOnly = false): Promise<string> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			throw new Error("Git is not installed")
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			throw new Error("Not a git repository")
		}

		let diff = ""
		// `git diff --staged` is valid even before the first commit (it diffs the
		// index against the empty tree), so it must NOT be gated on having a HEAD.
		// This is the common case for the very first commit of a new repo.
		let command = "git --no-pager diff --staged --diff-filter=d"
		const { stdout: staged } = await execAsync(command, { cwd })
		diff = staged.trim()

		// The unstaged fallback compares against HEAD, which only exists once the
		// repo has at least one commit. Skip it in a commit-less repo.
		if (!stagedOnly && !diff && (await checkGitRepoHasCommits(cwd))) {
			command = "git --no-pager diff HEAD --diff-filter=d"
			const { stdout: unstaged } = await execAsync(command, { cwd })
			diff = unstaged.trim()
		}

		// `git diff` never reports untracked (new, never-staged) files, so they are
		// missing from both diffs above. Append them in the non-staged path so an
		// add-only working tree works AND a mix of edited + new files includes both.
		if (!stagedOnly) {
			const untracked = await getUntrackedFilesDiff(cwd)
			if (untracked) {
				diff = diff ? `${diff}\n\n${untracked}` : untracked
				command = diff === untracked ? UNTRACKED_DIFF_LABEL : `${command} + ${UNTRACKED_DIFF_LABEL}`
			}
		}

		if (!diff) {
			throw new Error("No changes in workspace for commit message")
		}

		return truncateOutput(`'${command}' Output:\n\n${diff}`.trim())
	} catch (error) {
		throw error
	}
}

/**
 * Builds a diff for untracked (new, never-staged) files, which `git diff` and
 * `git diff --staged` both omit. Each file is diffed against an empty file via
 * `git diff --no-index` so the output looks like a normal added-file diff.
 * Returns an empty string when there are no untracked files.
 */
async function getUntrackedFilesDiff(cwd: string): Promise<string> {
	// `-z` returns NUL-separated, unquoted paths so filenames with spaces or
	// special characters survive intact.
	const { stdout: list } = await execFileAsync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd })
	const files = list.split("\0").filter((file) => file.length > 0)
	if (files.length === 0) {
		return ""
	}

	const diffs: string[] = []
	for (const file of files) {
		// Pass the filename as a separate argv entry (no shell) so names containing
		// quotes, `$`, backticks, or spaces can't be interpreted as shell syntax.
		// `git diff --no-index` exits 1 when the files differ (the normal case here),
		// which rejects the promise — capture stdout from that. Exit 2 is a real git
		// error (unreadable file, bad install), so re-throw it instead of swallowing.
		const { stdout } = await execFileAsync(
			"git",
			["--no-pager", "diff", "--no-index", "--diff-filter=d", "--", "/dev/null", file],
			{ cwd },
		).catch((error: { code?: number; stdout?: string }) => {
			if (error.code === 1) {
				return { stdout: error.stdout ?? "" }
			}
			throw error
		})
		const trimmed = stdout.trim()
		if (trimmed) {
			diffs.push(trimmed)
		}
	}
	return diffs.join("\n\n")
}

export async function getGitRemoteUrls(cwd: string): Promise<string[]> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return []
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return []
		}

		const { stdout } = await execAsync("git remote -v", { cwd })
		if (!stdout.trim()) {
			return []
		}

		// Parse output to extract unique URLs
		// git remote -v output format: "remoteName remoteUrl (fetch|push)"
		const remotes = stdout
			.trim()
			.split("\n")
			.filter((line) => line.includes("(fetch)")) // Only fetch URLs to avoid duplicates
			.map((line) => {
				const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/)
				return match ? { name: match[1], url: match[2] } : null
			})
			.filter((remote): remote is { name: string; url: string } => remote !== null)

		return remotes.map((remote) => `${remote.name}: ${remote.url}`)
	} catch (error) {
		Logger.error("Error getting git remotes:", error)
		return []
	}
}

export async function getLatestGitCommitHash(cwd: string): Promise<string | null> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return null
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return null
		}

		const { stdout } = await execAsync("git rev-parse HEAD", { cwd })
		return stdout.trim() || null
	} catch (error) {
		Logger.error("Error getting latest git commit hash:", error)
		return null
	}
}

function truncateOutput(content: string): string {
	if (!GIT_OUTPUT_LINE_LIMIT) {
		return content
	}

	const lines = content.split("\n")
	if (lines.length <= GIT_OUTPUT_LINE_LIMIT) {
		return content
	}

	const beforeLimit = Math.floor(GIT_OUTPUT_LINE_LIMIT * 0.2) // 20% of lines before
	const afterLimit = GIT_OUTPUT_LINE_LIMIT - beforeLimit // remaining 80% after
	return [
		...lines.slice(0, beforeLimit),
		`\n[...${lines.length - GIT_OUTPUT_LINE_LIMIT} lines omitted...]\n`,
		...lines.slice(-afterLimit),
	].join("\n")
}

// NEW: Additional functions for Stage 3 multi-workspace support
// These are the ONLY new additions needed for workspace detection

/**
 * Check if a directory is a Git repository (Stage 3 requirement)
 * @param dirPath - The directory path to check
 * @returns True if it's a Git repository
 */
async function isGitRepository(dirPath: string): Promise<boolean> {
	return await checkGitRepo(dirPath)
}
