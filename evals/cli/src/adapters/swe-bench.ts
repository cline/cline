import * as path from "path"
import * as fs from "fs"
import execa from "execa"
import { BenchmarkAdapter, Task, VerificationResult } from "./types"
import { swebench_tasks } from "@adapters/swe-bench-tasks"

const EVALS_DIR = path.resolve(__dirname, "../../../")

// Timeout constants
const GIT_CHECKOUT_TIMEOUT_MS = 30_000;
const GIT_FETCH_TIMEOUT_MS = 60_000;
const GIT_CLONE_TIMEOUT_MS = 600_000;
const COPY_TIMEOUT_MS = 60_000;
const CLEANUP_TIMEOUT_MS = 30_000;

// Directory names
const REPOSITORIES_DIR = "repositories";
const SWE_BENCH_DIR = "swe-bench";
const SWE_BENCH_BASE_DIR = "swe-bench-base";
const RESULTS_DIR = "results";
const PATCHES_DIR = "patches"; // jsonl output dir for swe-bench evaluation

// Git configuration
const GIT_USER_NAME = "SWE-Bench Evaluator";
const GIT_USER_EMAIL = "swe-bench@example.com";
const REPO_SEPARATOR = "__";
const GITHUB_BASE_URL = "https://github.com";

// File extensions and formats
const JSONL_EXTENSION = ".jsonl";
const GIT_DIR = ".git";

// List of unique repositories used in SWE-Bench verified
const UNIQUE_REPOSITORIES = [
	'astropy/astropy',
	'django/django',
	'matplotlib/matplotlib',
	'mwaskom/seaborn',
	'pallets/flask',
	'psf/requests',
	'pydata/xarray',
	'pylint-dev/pylint',
	'pytest-dev/pytest',
	'scikit-learn/scikit-learn',
	'sphinx-doc/sphinx',
	'sympy/sympy'
]

/**
 * SWE-Bench adapter for evaluating AI models on software engineering tasks
 */
export class SWEBenchAdapter implements BenchmarkAdapter {
	name = "swe-bench"

	/**
	 * Set up the SWE-Bench benchmark environment
	 */
	async setup(): Promise<void> {
		console.log(`Setting up SWE-Bench environment...`)

		// Create repositories directory if it doesn't exist
		const repoDir = path.join(EVALS_DIR, REPOSITORIES_DIR, SWE_BENCH_DIR)
		this.ensureDirectoryExists(repoDir)

		// Create patches output directory if it doesn't exist
		const patchesDir = path.join(EVALS_DIR, RESULTS_DIR, PATCHES_DIR)
		this.ensureDirectoryExists(patchesDir)

		// Create base repositories directory for pre-cloned repos
		const baseRepoDir = path.join(EVALS_DIR, REPOSITORIES_DIR, SWE_BENCH_BASE_DIR)
		this.ensureDirectoryExists(baseRepoDir)

		// Pre-clone all unique repositories
		await this.preCloneRepositories(baseRepoDir)

		console.log(`SWE-Bench setup completed`)
	}

	/**
	 * Pre-clone all unique repositories used in SWE-Bench
	 */
	private async preCloneRepositories(baseRepoDir: string): Promise<void> {
		console.log(`Pre-cloning ${UNIQUE_REPOSITORIES.length} unique repositories...`)

		for (let i = 0; i < UNIQUE_REPOSITORIES.length; i++) {
			const repo = UNIQUE_REPOSITORIES[i]
			const repoName = repo.replace('/', REPO_SEPARATOR)
			const repoPath = path.join(baseRepoDir, repoName)

			console.log(`[${i + 1}/${UNIQUE_REPOSITORIES.length}] Processing repository: ${repo}`)

			if (fs.existsSync(path.join(repoPath, GIT_DIR))) {
				console.log(`Repository ${repo} already exists, skipping...`)
			} else {
				console.log(`Cloning repository: ${GITHUB_BASE_URL}/${repo}`)
				
				const startTime = Date.now()
				try {
					this.ensureDirectoryExists(repoPath)
					await execa("git", ["clone", `${GITHUB_BASE_URL}/${repo}`, "."], {
						cwd: repoPath,
						timeout: GIT_CLONE_TIMEOUT_MS
					})
					const duration = (Date.now() - startTime) / 1000
					console.log(`Repository ${repo} cloned successfully in ${duration.toFixed(2)}s`)
				} catch (error: any) {
					console.error(`Failed to clone ${repo}: ${error.message}`)
					if (error.timedOut) {
						console.error(`Clone operation timed out after ${GIT_CLONE_TIMEOUT_MS / 60000} minutes`)
					}
					// Continue with other repositories even if one fails
				}
			}
		}

		console.log(`Pre-cloning completed`)
	}

	/**
	 * List all available tasks in the SWE-Bench benchmark
	 */
	async listTasks(): Promise<Task[]> {
		return swebench_tasks
	}

	/**
	 * Prepare a specific task for execution (validation only, no repository setup)
	 * @param taskId The ID of the task to prepare
	 */
	async prepareTask(taskId: string): Promise<Task> {
		const tasks = await this.listTasks()
		const task = tasks.find((t) => t.id === taskId)

		if (!task) {
			throw new Error(`Task ${taskId} not found`)
		}

		// Validate that the pre-cloned repository exists
		const baseRepoDir = path.join(EVALS_DIR, REPOSITORIES_DIR, SWE_BENCH_BASE_DIR)
		const repoName = task.metadata.repository.replace('/', REPO_SEPARATOR)
		const sourceRepoPath = path.join(baseRepoDir, repoName)

		if (!fs.existsSync(path.join(sourceRepoPath, GIT_DIR))) {
			throw new Error(`Pre-cloned repository not found: ${sourceRepoPath}. Please run setup first.`)
		}

		return task
	}

	/**
	 * Setup workspace for a specific task (copy repository and checkout commit)
	 * This should be called right before the task execution starts
	 * @param task The task to setup workspace for
	 */
	async setupTaskWorkspace(task: Task): Promise<void> {
		console.log(`Setting up workspace for task: ${task.id}`)

		// Create task-specific workspace directory
		const taskWorkspace = task.workspacePath
		this.ensureDirectoryExists(taskWorkspace)

		// Copy from pre-cloned repository
		const baseRepoDir = path.join(EVALS_DIR, REPOSITORIES_DIR, SWE_BENCH_BASE_DIR)
		const repoName = task.metadata.repository.replace('/', REPO_SEPARATOR)
		const sourceRepoPath = path.join(baseRepoDir, repoName)

		const startTime = Date.now()
		
		try {
			await this.copyDirectory(sourceRepoPath, taskWorkspace)
			const duration = (Date.now() - startTime) / 1000
		} catch (error: any) {
			console.error(`Failed to copy repository: ${error.message}`)
			throw new Error(`Failed to copy repository: ${error.message}`)
		}

		// Checkout the specific issue commit
		console.log(`Checking out issue commit: ${task.metadata.issue}`)
		await this.checkoutCommit(task.metadata.issue, taskWorkspace)

		// Ensure git is properly configured for commits
		try {
			await execa("git", ["config", "user.name"], { cwd: taskWorkspace })
		} catch {
			console.log(`Setting git user configuration...`)
			await execa("git", ["config", "user.name", GIT_USER_NAME], { cwd: taskWorkspace })
			await execa("git", ["config", "user.email", GIT_USER_EMAIL], { cwd: taskWorkspace })
			console.log(`Git user configuration set successfully`)
		}

	}

	/**
	 * Checkout a specific commit with fetch fallback
	 * @param ref The commit reference to checkout
	 * @param cwd The working directory to execute git commands in
	 */
	private async checkoutCommit(ref: string, cwd: string): Promise<void> {
		try {
			await execa("git", ["fetch", "origin", ref], { cwd, timeout: GIT_FETCH_TIMEOUT_MS });
			await execa("git", ["checkout", ref], { cwd, timeout: GIT_CHECKOUT_TIMEOUT_MS });

			console.log(`Checked out commit: ${ref}`);
		} catch (err: any) {
			throw new Error(`Failed to fetch/checkout commit ${ref}: ${err.message}`);
		}
	}

	/**
	 * Copy directory contents efficiently using cp command
	 */
	private async copyDirectory(source: string, destination: string): Promise<void> {
		try {
			// Use cp -r to copy the entire directory structure
			await execa("cp", ["-r", source + "/.", destination], {
				timeout: COPY_TIMEOUT_MS
			})
		} catch (error: any) {
			// Fallback to rsync if cp fails
			console.log(`cp failed, trying rsync...`)
			try {
				await execa("rsync", ["-a", source + "/", destination], {
					timeout: COPY_TIMEOUT_MS
				})
			} catch (rsyncError: any) {
				throw new Error(`Both cp and rsync failed: ${error.message}, ${rsyncError.message}`)
			}
		}
	}

	/**
	 * Verify the result of a task execution and capture git diff
	 * @param task The task that was executed
	 * @param result The result of the task execution
	 */
	async verifyResult(task: Task, result: any): Promise<VerificationResult> {
		try {
			// Get the model name from task metadata (should be set by the run command)
			const modelName = this.getModelName(task)
			if (!modelName) {
				return {
					success: false,
					metrics: {
						patchGenerated: false,
						reason: "No model name available"
					}
				}
			}

			// Check if there are any changes to capture
			const statusResult = await execa("git", ["status", "--porcelain"], { 
				cwd: task.workspacePath 
			})

			const diffResult = await execa("git", ["diff", "--no-color"], { 
				cwd: task.workspacePath 
			})

			const hasStagedChanges = statusResult.stdout.trim().length > 0
			const hasUnstagedChanges = diffResult.stdout.trim().length > 0

			if (!hasStagedChanges && !hasUnstagedChanges) {
				console.log(`No changes detected, skipping patch generation`)
				return {
					success: false,
					metrics: {
						patchGenerated: false,
						reason: "No changes detected"
					}
				}
			}

			// Stage all changes before generating diff
			if (hasStagedChanges) {
				await execa("git", ["add", "."], { cwd: task.workspacePath })
			}

			// Generate the complete diff
			const finalDiffResult = await execa("git", ["diff", "--no-color", "--cached"], { 
				cwd: task.workspacePath 
			})

			const patch = finalDiffResult.stdout

			if (!patch.trim()) {
				return {
					success: false,
					metrics: {
						patchGenerated: false,
						reason: "Empty patch"
					}
				}
			}

			// Write to JSONL file
			const patchData = {
				instance_id: task.id,
				model_name_or_path: modelName,
				model_patch: patch
			}

			const patchesDir = path.join(EVALS_DIR, RESULTS_DIR, PATCHES_DIR)
			const jsonlFile = path.join(patchesDir, `${modelName}${JSONL_EXTENSION}`)
			
			await this.writeToJsonl(jsonlFile, patchData)

			// Clean up task-specific repository to save space
			await this.cleanupTaskWorkspace(task.workspacePath)

			return {
				success: true,
				metrics: {
					patchGenerated: true,
					patchSize: patch.length,
					modelName: modelName,
					outputFile: jsonlFile
				}
			}

		} catch (error: any) {
			console.error(`Error capturing git diff: ${error.message}`)
			
			// Still try to clean up even if patch generation failed
			try {
				await this.cleanupTaskWorkspace(task.workspacePath)
			} catch (cleanupError: any) {
				console.warn(`Failed to cleanup workspace: ${cleanupError.message}`)
			}

			return {
				success: false,
				metrics: {
					patchGenerated: false,
					error: error.message
				}
			}
		}
	}

	/**
	 * Clean up task-specific workspace to save disk space
	 */
	private async cleanupTaskWorkspace(workspacePath: string): Promise<void> {
		try {
			if (fs.existsSync(workspacePath)) {
				await execa("rm", ["-rf", workspacePath], {
					timeout: CLEANUP_TIMEOUT_MS
				})
			}

			// Also clean up the swe-bench directory if it exists
			const sweBenchDir = path.join(EVALS_DIR, REPOSITORIES_DIR, SWE_BENCH_DIR)
			if (fs.existsSync(sweBenchDir)) {
				await execa("rm", ["-rf", sweBenchDir], {
					timeout: CLEANUP_TIMEOUT_MS
				})
			}
		} catch (error: any) {
			console.warn(`Failed to cleanup workspace: ${error.message}`)
			// Don't throw error for cleanup failures
		}
	}

	/**
	 * Helper method to ensure a directory exists
	 */
	private ensureDirectoryExists(dirPath: string): void {
		if (!fs.existsSync(dirPath)) {
			fs.mkdirSync(dirPath, { recursive: true })
		}
	}

	/**
	 * Helper method to write data to a JSONL file
	 */
	private async writeToJsonl(filePath: string, data: object): Promise<void> {
		const jsonLine = JSON.stringify(data) + '\n'
		fs.appendFileSync(filePath, jsonLine, 'utf8')
	}

	/**
	 * Helper method to get model name from task metadata
	 */
	private getModelName(task: Task): string | null {
		return task.metadata?.modelName || null
	}
}
