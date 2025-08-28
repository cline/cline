import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)
const GIT_OUTPUT_LINE_LIMIT = 500

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
			console.error("Git is not installed")
			return []
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			console.error("Not a git repository")
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
		console.error("Error searching commits:", error)
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
		console.error("Error getting commit info:", error)
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
		console.error("Error getting working state:", error)
		return `Failed to get working state: ${error instanceof Error ? error.message : String(error)}`
	}
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
		console.error("Error getting git remotes:", error)
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
		console.error("Error getting latest git commit hash:", error)
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
