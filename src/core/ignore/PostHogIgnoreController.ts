import path from 'path'
import { fileExistsAtPath } from '../../utils/fs'
import fs from 'fs/promises'
import ignore, { Ignore } from 'ignore'
import * as vscode from 'vscode'

export const LOCK_TEXT_SYMBOL = '\u{1F512}'

/**
 * Controls LLM access to files by enforcing ignore patterns.
 * Designed to be instantiated once in PostHog.ts and passed to file manipulation services.
 * Uses the 'ignore' library to support standard .gitignore syntax
 */
export class PostHogIgnoreController {
    private cwd: string
    private ignoreInstance: Ignore
    private disposables: vscode.Disposable[] = []
    gitIgnoreContent: string | undefined

    constructor(cwd: string) {
        this.cwd = cwd
        this.ignoreInstance = ignore()
        this.gitIgnoreContent = undefined
        // Set up file watcher for .gitignore
        this.setupFileWatcher()
    }

    /**
     * Initialize the controller by loading custom patterns
     * Must be called after construction and before using the controller
     */
    async initialize(): Promise<void> {
        await this.loadGitIgnore()
    }

    /**
     * Set up the file watcher for .gitignore changes
     */
    private setupFileWatcher(): void {
        const gitignorePattern = new vscode.RelativePattern(this.cwd, '.gitignore')
        const fileWatcher = vscode.workspace.createFileSystemWatcher(gitignorePattern)

        // Watch for changes and updates
        this.disposables.push(
            fileWatcher.onDidChange(() => {
                this.loadGitIgnore()
            }),
            fileWatcher.onDidCreate(() => {
                this.loadGitIgnore()
            }),
            fileWatcher.onDidDelete(() => {
                this.loadGitIgnore()
            })
        )

        // Add fileWatcher itself to disposables
        this.disposables.push(fileWatcher)
    }

    /**
     * Load patterns from .gitignore
     */
    private async loadGitIgnore(): Promise<void> {
        try {
            // Reset ignore instance to prevent duplicate patterns
            this.ignoreInstance = ignore()

            const gitIgnorePath = path.join(this.cwd, '.gitignore')

            if (await fileExistsAtPath(gitIgnorePath)) {
                const content = await fs.readFile(gitIgnorePath, 'utf8')
                this.gitIgnoreContent = content
                this.ignoreInstance.add(content)
                this.ignoreInstance.add('.gitignore')
            } else {
                this.gitIgnoreContent = undefined
            }
        } catch (error) {
            // Should never happen: reading file failed even though it exists
            console.error('Unexpected error loading .gitignore:', error)
        }
    }

    /**
     * Check if a file should be accessible to the LLM
     * @param filePath - Path to check (relative to cwd)
     * @returns true if file is accessible, false if ignored
     */
    validateAccess(filePath: string): boolean {
        // Always allow access if .gitignore does not exist
        if (!this.gitIgnoreContent) {
            return true
        }
        try {
            // Normalize path to be relative to cwd and use forward slashes
            const absolutePath = path.resolve(this.cwd, filePath)
            const relativePath = path.relative(this.cwd, absolutePath).toPosix()

            // Ignore expects paths to be path.relative()'d
            return !this.ignoreInstance.ignores(relativePath)
        } catch (error) {
            // console.error(`Error validating access for ${filePath}:`, error)
            // Ignore is designed to work with relative file paths, so will throw error for paths outside cwd. We are allowing access to all files outside cwd.
            return true
        }
    }

    /**
     * Check if a terminal command should be allowed to execute based on file access patterns
     * @param command - Terminal command to validate
     * @returns path of file that is being accessed if it is being accessed, undefined if command is allowed
     */
    validateCommand(command: string): string | undefined {
        // Always allow if no .gitignore exists
        if (!this.gitIgnoreContent) {
            return undefined
        }

        // Split command into parts and get the base command
        const parts = command.trim().split(/\s+/)
        const baseCommand = parts[0].toLowerCase()

        // Commands that read file contents
        const fileReadingCommands = [
            // Unix commands
            'cat',
            'less',
            'more',
            'head',
            'tail',
            'grep',
            'awk',
            'sed',
            // PowerShell commands and aliases
            'get-content',
            'gc',
            'type',
            'select-string',
            'sls',
        ]

        if (fileReadingCommands.includes(baseCommand)) {
            // Check each argument that could be a file path
            for (let i = 1; i < parts.length; i++) {
                const arg = parts[i]
                // Skip command flags/options (both Unix and PowerShell style)
                if (arg.startsWith('-') || arg.startsWith('/')) {
                    continue
                }
                // Ignore PowerShell parameter names
                if (arg.includes(':')) {
                    continue
                }
                // Validate file access
                if (!this.validateAccess(arg)) {
                    return arg
                }
            }
        }

        return undefined
    }

    /**
     * Filter an array of paths, removing those that should be ignored
     * @param paths - Array of paths to filter (relative to cwd)
     * @returns Array of allowed paths
     */
    filterPaths(paths: string[]): string[] {
        try {
            return paths
                .map((p) => ({
                    path: p,
                    allowed: this.validateAccess(p),
                }))
                .filter((x) => x.allowed)
                .map((x) => x.path)
        } catch (error) {
            console.error('Error filtering paths:', error)
            return [] // Fail closed for security
        }
    }

    /**
     * Clean up resources when the controller is no longer needed
     */
    dispose(): void {
        this.disposables.forEach((d) => d.dispose())
        this.disposables = []
    }
}
