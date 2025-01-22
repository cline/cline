import { statSync, readdirSync } from "fs"
import { basename, join } from "path"
import { minimatch } from "minimatch"

/**
 * Interface for tree generation options
 */
interface TreeOptions {
	prefix?: string
	isLast?: boolean
	excludePatterns?: string[]
}

/**
 * Service class for generating ASCII directory trees
 */
export class DirectoryTreeService {
	private readonly defaultIgnorePatterns: readonly string[]

	constructor() {
		this.defaultIgnorePatterns = DEFAULT_IGNORE_PATTERNS
	}

	/**
	 * Creates an ASCII tree representation of a directory or file
	 * @param rootDir - Path to the root directory or file
	 * @param options - Configuration options for tree generation
	 * @returns ASCII tree representation as a string
	 */
	public getDirectoryStructure(
		rootDir: string,
		{ prefix = "", isLast = true, excludePatterns = [] }: TreeOptions = {},
	): string {
		let tree = ""
		const baseName = basename(rootDir)

		// Check if item should be ignored
		if (this.shouldIgnore(baseName) || excludePatterns.some((pattern) => minimatch(baseName, pattern, { dot: true }))) {
			return ""
		}

		try {
			const stats = statSync(rootDir)
			const isDirectory = stats.isDirectory()
			const linePrefix = isLast ? "└── " : "├── "

			// Build current item line
			tree += prefix + linePrefix + baseName + (isDirectory ? "/" : "") + "\n"

			// Process directory contents if applicable
			if (isDirectory) {
				const children = readdirSync(rootDir)
				const newPrefix = prefix + (isLast ? "    " : "│   ")

				children.forEach((childName, index) => {
					const childPath = join(rootDir, childName)
					const childIsLast = index === children.length - 1

					tree += this.getDirectoryStructure(childPath, {
						prefix: newPrefix,
						isLast: childIsLast,
						excludePatterns,
					})
				})
			}

			return tree
		} catch (error) {
			console.error(`Error processing ${rootDir}:`, error)
			return ""
		}
	}

	/**
	 * Checks if a file or directory should be ignored based on default patterns
	 * @param filePath - Path to check
	 * @returns boolean indicating if the path should be ignored
	 */
	private shouldIgnore(filePath: string): boolean {
		return this.defaultIgnorePatterns.some((pattern) => minimatch(filePath, pattern, { dot: true }))
	}
}

/**
 * Default patterns to ignore when generating the tree
 */
export const DEFAULT_IGNORE_PATTERNS = [
	// Development
	"node_modules",
	"bower_components",
	".git",
	".svn",
	".hg",
	".npm",
	".yarn",
	".pnpm-store",

	// Build outputs
	"dist",
	"build",
	"out",
	"target",
	".next",
	".nuxt",
	".docusaurus",

	// Cache and temporary
	".cache",
	"__pycache__",
	".pytest_cache",
	".ruff_cache",
	".mypy_cache",
	".hypothesis",
	".sass-cache",
	".eslintcache",

	// Lock files
	"package-lock.json",
	"yarn.lock",
	"poetry.lock",
	"Pipfile.lock",
	"Cargo.lock",
	"Gemfile.lock",

	// IDE and editors
	".idea",
	".vscode",
	".vs",
	"*.sublime-*",
	"*.swp",
	"*.swo",
	"*.swn",

	// Compiled files
	"*.pyc",
	"*.pyo",
	"*.pyd",
	"*.class",
	"*.dll",
	"*.exe",
	"*.so",
	"*.dylib",

	// Environment
	".env",
	"venv",
	".venv",
	"env",
	"virtualenv",

	// System
	".DS_Store",
	"Thumbs.db",
	"desktop.ini",

	// Media and binaries
	"*.svg",
	"*.png",
	"*.jpg",
	"*.jpeg",
	"*.gif",
	"*.ico",
	"*.pdf",
	"*.mov",
	"*.mp4",
	"*.mp3",
	"*.wav",

	// Logs and temporary
	"*.log",
	"*.bak",
	"*.tmp",
	"*.temp",

	// Source maps
	"*.map",

	// Minified files
	"*.min.js",
	"*.min.css",

	// Infrastructure
	".terraform",
	"*.tfstate*",
] as const
