/**
 * File search utility for CLI
 * Uses ripgrep if available, otherwise falls back to Node.js fs.readdir
 * FZF is used for fuzzy matching
 */
import { execFileSync, spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import { basename, dirname, join, relative } from "node:path"
import { createInterface } from "node:readline"
import type { Fzf, FzfResultItem } from "fzf"
import { Logger } from "@/shared/services/Logger"

export interface FileSearchResult {
	path: string
	type: "file" | "folder"
	label: string
}

const EXCLUDED_DIRS = new Set([
	"node_modules",
	".git",
	".github",
	"out",
	"dist",
	"__pycache__",
	".venv",
	".env",
	"venv",
	"env",
	".cache",
	"tmp",
	"temp",
	".next",
	"coverage",
	"build",
])

const RG_EXCLUDE_GLOB = "!**/{node_modules,.git,.github,out,dist,__pycache__,.venv,.env,venv,env,.cache,tmp,temp}/**"

// Cached state
let ripgrepAvailable: boolean | null = null
let ripgrepWarningShown = false
let fzfModule: { Fzf: typeof Fzf; byLengthAsc: any } | null = null

function checkRipgrep(): boolean {
	if (ripgrepAvailable !== null) {
		return ripgrepAvailable
	}
	try {
		execFileSync("which", ["rg"], { stdio: "ignore" })
		ripgrepAvailable = true
	} catch {
		ripgrepAvailable = false
	}
	return ripgrepAvailable
}

function addParentDirs(relativePath: string, dirSet: Set<string>): void {
	let dir = dirname(relativePath)
	while (dir && dir !== "." && dir !== "/") {
		dirSet.add(dir)
		dir = dirname(dir)
	}
}

function dirsToResults(dirSet: Set<string>): FileSearchResult[] {
	return Array.from(dirSet, (p) => ({ path: p, type: "folder" as const, label: basename(p) }))
}

async function listFilesWithNodeFs(workspacePath: string, limit: number): Promise<FileSearchResult[]> {
	const files: FileSearchResult[] = []
	const dirs = new Set<string>()

	async function walk(dir: string): Promise<void> {
		if (files.length >= limit) {
			return
		}

		try {
			const entries = await fs.readdir(dir, { withFileTypes: true })

			for (const entry of entries) {
				if (files.length >= limit) {
					break
				}

				const name = entry.name
				if (entry.isDirectory() && EXCLUDED_DIRS.has(name)) {
					continue
				}
				if (name.startsWith(".") && !name.startsWith(".cline")) {
					continue
				}

				const fullPath = join(dir, name)
				const relativePath = relative(workspacePath, fullPath)

				if (entry.isDirectory()) {
					dirs.add(relativePath)
					await walk(fullPath)
				} else if (entry.isFile()) {
					files.push({ path: relativePath, type: "file", label: name })
					addParentDirs(relativePath, dirs)
				}
			}
		} catch {
			return
		}
	}

	await walk(workspacePath)
	return [...files, ...dirsToResults(dirs)]
}

async function listFilesWithRipgrep(workspacePath: string, limit: number): Promise<FileSearchResult[]> {
	return new Promise((resolve, reject) => {
		const rg = spawn("rg", ["--files", "--follow", "--hidden", "-g", RG_EXCLUDE_GLOB, workspacePath])
		const rl = createInterface({ input: rg.stdout })

		const files: FileSearchResult[] = []
		const dirs = new Set<string>()
		let stderr = ""

		rl.on("line", (line) => {
			if (files.length >= limit) {
				rl.close()
				rg.kill()
				return
			}

			const relativePath = relative(workspacePath, line)
			files.push({ path: relativePath, type: "file", label: basename(relativePath) })
			addParentDirs(relativePath, dirs)
		})

		rg.stderr.on("data", (data) => {
			stderr += data
		})

		rl.on("close", () => {
			if (stderr && files.length === 0) {
				reject(new Error(`ripgrep error: ${stderr.trim()}`))
			} else {
				resolve([...files, ...dirsToResults(dirs)])
			}
		})

		rg.on("error", (err) => reject(new Error(`ripgrep error: ${err.message}`)))
	})
}

export function checkAndWarnRipgrepMissing(): boolean {
	if (!checkRipgrep() && !ripgrepWarningShown) {
		ripgrepWarningShown = true
		return true
	}
	return false
}

export function getRipgrepInstallInstructions(): string {
	switch (process.platform) {
		case "darwin":
			return "brew install ripgrep"
		case "linux":
			return "apt install ripgrep  # or: yum install ripgrep"
		case "win32":
			return "choco install ripgrep  # or: scoop install ripgrep"
		default:
			return "https://github.com/BurntSushi/ripgrep#installation"
	}
}

export async function listWorkspaceFiles(workspacePath: string, limit = 5000): Promise<FileSearchResult[]> {
	if (checkRipgrep()) {
		try {
			return await listFilesWithRipgrep(workspacePath, limit)
		} catch {
			ripgrepAvailable = false
		}
	}
	return listFilesWithNodeFs(workspacePath, limit)
}

function countGaps(positions: Iterable<number>): number {
	let gaps = 0
	let prev = -Infinity
	for (const pos of positions) {
		if (prev !== -Infinity && pos - prev > 1) {
			gaps++
		}
		prev = pos
	}
	return gaps
}

const orderByMatchScore = (a: FzfResultItem<FileSearchResult>, b: FzfResultItem<FileSearchResult>) =>
	countGaps(a.positions) - countGaps(b.positions)

export async function searchWorkspaceFiles(
	query: string,
	workspacePath: string,
	limit = 15,
	selectedType?: "file" | "folder",
): Promise<FileSearchResult[]> {
	try {
		let items = await listWorkspaceFiles(workspacePath, 5000)

		if (selectedType) {
			items = items.filter((item) => item.type === selectedType)
		}

		if (!query.trim()) {
			return items.slice(0, limit)
		}

		// Lazy load fzf module
		if (!fzfModule) {
			fzfModule = await import("fzf")
		}

		const fzf = new fzfModule.Fzf(items, {
			selector: (item: FileSearchResult) => `${item.label} ${item.path}`,
			tiebreakers: [orderByMatchScore, fzfModule.byLengthAsc],
			limit: limit * 2,
		})

		return fzf
			.find(query)
			.slice(0, limit)
			.map((r) => r.item)
	} catch (error) {
		Logger.error("File search error:", error)
		return []
	}
}

export function extractMentionQuery(text: string): { inMentionMode: boolean; query: string; atIndex: number } {
	const lastAtIndex = text.lastIndexOf("@")

	if (lastAtIndex === -1 || (lastAtIndex > 0 && !/\s/.test(text[lastAtIndex - 1]))) {
		return { inMentionMode: false, query: "", atIndex: -1 }
	}

	const afterAt = text.slice(lastAtIndex + 1)
	if (afterAt.includes(" ")) {
		return { inMentionMode: false, query: "", atIndex: -1 }
	}

	return { inMentionMode: true, query: afterAt, atIndex: lastAtIndex }
}

export function insertMention(text: string, atIndex: number, filePath: string): string {
	const endIndex = text.indexOf(" ", atIndex)
	const end = endIndex === -1 ? text.length : endIndex
	// Ensure path starts with / for proper mention format
	const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`
	const mention = normalizedPath.includes(" ") ? `@"${normalizedPath}"` : `@${normalizedPath}`
	return text.slice(0, atIndex) + mention + " " + text.slice(end).trimStart()
}
