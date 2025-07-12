const { dialog, shell, clipboard } = require("electron")
const fs = require("fs").promises
const path = require("path")
const { spawn, exec } = require("child_process")
const os = require("os")
const { promisify } = require("util")

const execAsync = promisify(exec)

/**
 * Real implementations of host bridge services for Electron
 */

class ElectronWorkspaceService {
	async getWorkspacePaths(request) {
		// For now, return the current working directory
		// In a real implementation, this would come from opened folders
		return {
			paths: [process.cwd()],
		}
	}

	async findFiles(request) {
		// Basic file finding implementation
		const { glob } = request
		const workspacePath = process.cwd()

		try {
			const files = await this.findFilesInDirectory(workspacePath, glob)
			return { files: files.slice(0, 100) } // Limit results
		} catch (error) {
			console.error("Error finding files:", error)
			return { files: [] }
		}
	}

	async findFilesInDirectory(directory, pattern) {
		// Simple file search implementation
		const files = []
		try {
			const items = await fs.readdir(directory)
			for (const item of items) {
				const fullPath = path.join(directory, item)
				const stat = await fs.stat(fullPath)
				if (stat.isFile() && item.includes(pattern || "")) {
					files.push(fullPath)
				}
			}
		} catch (error) {
			// Ignore errors for now
		}
		return files
	}

	async searchFiles(request) {
		try {
			const workspacePath = process.cwd()
			const query = request.query || ""
			const limit = request.limit || 20

			if (!query) {
				return {
					results: [],
					mentionsRequestId: request.mentionsRequestId,
				}
			}

			// Simple file search implementation
			const results = []

			const searchInDirectory = async (dir, currentDepth = 0) => {
				if (currentDepth > 3) return // Limit depth to avoid too deep recursion

				try {
					const items = await fs.readdir(dir)

					for (const item of items) {
						if (results.length >= limit) break

						// Skip hidden files and common non-relevant directories
						if (item.startsWith(".") || item === "node_modules" || item === "dist") {
							continue
						}

						const fullPath = path.join(dir, item)
						const relativePath = path.relative(workspacePath, fullPath)

						try {
							const stat = await fs.stat(fullPath)

							// Check if file/folder name matches query
							if (item.toLowerCase().includes(query.toLowerCase())) {
								results.push({
									path: relativePath,
									type: stat.isDirectory() ? "folder" : "file",
									label: item,
								})
							}

							// Recursively search directories
							if (stat.isDirectory() && currentDepth < 3) {
								await searchInDirectory(fullPath, currentDepth + 1)
							}
						} catch (error) {
							// Skip files we can't access
							continue
						}
					}
				} catch (error) {
					// Skip directories we can't read
					return
				}
			}

			await searchInDirectory(workspacePath)

			return {
				results,
				mentionsRequestId: request.mentionsRequestId,
			}
		} catch (error) {
			console.error("Error searching files:", error)
			return {
				results: [],
				mentionsRequestId: request.mentionsRequestId,
			}
		}
	}
}

class ElectronWindowService {
	constructor(mainWindow) {
		this.mainWindow = mainWindow
	}

	async showTextDocument(request) {
		// Open file in system default editor
		try {
			await shell.openPath(request.documentPath)
			return { documentPath: request.documentPath, isActive: true }
		} catch (error) {
			console.error("Error opening document:", error)
			return { documentPath: "", isActive: false }
		}
	}

	async showOpenDialogue(request) {
		const result = await dialog.showOpenDialog(this.mainWindow, {
			properties: ["openFile", "openDirectory", "multiSelections"],
			title: request.title || "Select Files",
		})

		return {
			paths: result.canceled ? [] : result.filePaths,
		}
	}

	async getActiveTextEditor(request) {
		// For Electron, we don't have a built-in text editor
		// This would need to be implemented based on your UI
		return { documentPath: "", isActive: false }
	}

	async getVisibleTextEditors(request) {
		return { editors: [] }
	}

	async showErrorMessage(request) {
		const result = await dialog.showMessageBox(this.mainWindow, {
			type: "error",
			title: "Error",
			message: request.message,
			buttons: request.items || ["OK"],
		})

		return {
			selectedItem: request.items ? request.items[result.response] : undefined,
		}
	}

	async showInformationMessage(request) {
		const result = await dialog.showMessageBox(this.mainWindow, {
			type: "info",
			title: "Information",
			message: request.message,
			buttons: request.items || ["OK"],
		})

		return {
			selectedItem: request.items ? request.items[result.response] : undefined,
		}
	}

	async showWarningMessage(request) {
		const result = await dialog.showMessageBox(this.mainWindow, {
			type: "warning",
			title: "Warning",
			message: request.message,
			buttons: request.items || ["OK"],
			defaultId: 0,
			cancelId: request.items ? request.items.length : 1,
			noLink: true,
			normalizeAccessKeys: true,
		})

		return {
			selectedItem: request.items ? request.items[result.response] : undefined,
		}
	}
}

class ElectronTerminalService {
	constructor() {
		this.terminals = new Map()
		this.activeTerminalId = null
	}

	async createTerminal(request) {
		const terminalId = Date.now().toString()

		// Create a new terminal process
		const terminal = spawn(process.env.SHELL || "bash", [], {
			cwd: request.cwd || process.cwd(),
			env: process.env,
		})

		this.terminals.set(terminalId, {
			id: terminalId,
			name: request.name || `Terminal ${terminalId}`,
			process: terminal,
			isActive: true,
		})

		this.activeTerminalId = terminalId

		return {
			id: terminalId,
			name: request.name || `Terminal ${terminalId}`,
			isActive: true,
		}
	}

	async getActiveTerminal(request) {
		if (this.activeTerminalId && this.terminals.has(this.activeTerminalId)) {
			const terminal = this.terminals.get(this.activeTerminalId)
			return {
				id: terminal.id,
				name: terminal.name,
				isActive: true,
			}
		}

		return { id: "", name: "", isActive: false }
	}

	async getAllTerminals(request) {
		const terminals = Array.from(this.terminals.values()).map((terminal) => ({
			id: terminal.id,
			name: terminal.name,
			isActive: terminal.id === this.activeTerminalId,
		}))

		return { terminals }
	}
}

class ElectronCommandService {
	constructor(mainWindow) {
		this.mainWindow = mainWindow
	}

	async executeCommand(request) {
		const { command, args } = request

		switch (command) {
			case "workbench.action.reloadWindow":
				this.mainWindow.reload()
				break
			case "workbench.action.toggleDevTools":
				this.mainWindow.webContents.toggleDevTools()
				break
			case "vscode.open":
				if (args && args[0]) {
					await shell.openPath(args[0])
				}
				break
			default:
				console.log(`Command not implemented: ${command}`)
		}

		return {}
	}

	async setContext(request) {
		// Context setting - could be used for UI state
		console.log(`Setting context: ${request.key} = ${request.value}`)
		return {}
	}

	async focusSidebar(request) {
		// Focus sidebar - UI implementation needed
		return {}
	}

	async newGroupRight(request) {
		// New editor group - UI implementation needed
		return {}
	}

	async lockEditorGroup(request) {
		// Lock editor group - UI implementation needed
		return {}
	}

	async openWalkthrough(request) {
		// Open walkthrough - UI implementation needed
		return {}
	}

	async reloadWindow(request) {
		this.mainWindow.reload()
		return {}
	}
}

class ElectronEnvService {
	async clipboardWriteText(request) {
		clipboard.writeText(request.value)
		return {}
	}

	async clipboardReadText(request) {
		const text = clipboard.readText()
		return { value: text }
	}
}

class ElectronWatchService {
	async subscribeToFile(request, responseStream, requestId) {
		// File watching implementation would go here
		// For now, just acknowledge the subscription
		console.log(`Watching file: ${request.filePath}`)
		return
	}
}

class ElectronFileService {
	async searchCommits(request) {
		try {
			const workspacePath = process.cwd()
			const query = request.value || ""

			// Check if git is installed
			try {
				await execAsync("git --version")
			} catch (error) {
				console.error("Git is not installed")
				return { commits: [] }
			}

			// Check if this is a git repository
			try {
				await execAsync("git rev-parse --git-dir", { cwd: workspacePath })
			} catch (error) {
				console.error("Not a git repository")
				return { commits: [] }
			}

			// Check if repo has any commits
			try {
				await execAsync("git rev-parse HEAD", { cwd: workspacePath })
			} catch (error) {
				// No commits yet in the repository
				return { commits: [] }
			}

			// Search commits by hash or message, limiting to 10 results
			const { stdout } = await execAsync(
				`git log -n 10 --format="%H%n%h%n%s%n%an%n%ad" --date=short --grep="${query}" --regexp-ignore-case`,
				{ cwd: workspacePath },
			)

			let output = stdout
			if (!output.trim() && /^[a-f0-9]+$/i.test(query)) {
				// If no results from grep search and query looks like a hash, try searching by hash
				try {
					const { stdout: hashStdout } = await execAsync(
						`git log -n 10 --format="%H%n%h%n%s%n%an%n%ad" --date=short --author-date-order ${query}`,
						{ cwd: workspacePath },
					)
					output = hashStdout
				} catch (error) {
					output = ""
				}
			}

			const commits = []
			const lines = output
				.trim()
				.split("\n")
				.filter((line) => line !== "--")

			for (let i = 0; i < lines.length; i += 5) {
				commits.push({
					hash: lines[i] || "",
					shortHash: lines[i + 1] || "",
					subject: lines[i + 2] || "",
					author: lines[i + 3] || "",
					date: lines[i + 4] || "",
				})
			}

			return { commits }
		} catch (error) {
			console.error("Error searching commits:", error)
			return { commits: [] }
		}
	}

	async searchFiles(request) {
		try {
			const workspacePath = process.cwd()
			const query = request.query || ""
			const limit = request.limit || 20

			if (!query) {
				return {
					results: [],
					mentionsRequestId: request.mentionsRequestId,
				}
			}

			// Simple file search implementation
			const results = []

			const searchInDirectory = async (dir, currentDepth = 0) => {
				if (currentDepth > 3) return // Limit depth to avoid too deep recursion

				try {
					const items = await fs.readdir(dir)

					for (const item of items) {
						if (results.length >= limit) break

						// Skip hidden files and common non-relevant directories
						if (item.startsWith(".") || item === "node_modules" || item === "dist") {
							continue
						}

						const fullPath = path.join(dir, item)
						const relativePath = path.relative(workspacePath, fullPath)

						try {
							const stat = await fs.stat(fullPath)

							// Check if file/folder name matches query
							if (item.toLowerCase().includes(query.toLowerCase())) {
								results.push({
									path: relativePath,
									type: stat.isDirectory() ? "folder" : "file",
									label: item,
								})
							}

							// Recursively search directories
							if (stat.isDirectory() && currentDepth < 3) {
								await searchInDirectory(fullPath, currentDepth + 1)
							}
						} catch (error) {
							// Skip files we can't access
							continue
						}
					}
				} catch (error) {
					// Skip directories we can't read
					return
				}
			}

			await searchInDirectory(workspacePath)

			return {
				results,
				mentionsRequestId: request.mentionsRequestId,
			}
		} catch (error) {
			console.error("Error searching files:", error)
			return {
				results: [],
				mentionsRequestId: request.mentionsRequestId,
			}
		}
	}
}

module.exports = {
	ElectronWorkspaceService,
	ElectronWindowService,
	ElectronTerminalService,
	ElectronCommandService,
	ElectronEnvService,
	ElectronWatchService,
	ElectronFileService,
}
