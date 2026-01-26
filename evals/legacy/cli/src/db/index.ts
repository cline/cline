import Database from "better-sqlite3"
import * as fs from "fs"
import * as path from "path"
import { SCHEMA } from "./schema"

const EVALS_DIR = path.resolve(__dirname, "../../../")

/**
 * Database class for storing evaluation results
 */
export class ResultsDatabase {
	db: Database.Database

	constructor() {
		// Ensure results directory exists
		const resultsDir = path.join(EVALS_DIR, "results")
		fs.mkdirSync(resultsDir, { recursive: true })

		// Create database file
		const dbPath = path.join(resultsDir, "evals.db")
		this.db = new Database(dbPath)

		// Initialize schema
		this.initSchema()
	}

	/**
	 * Initialize the database schema
	 */
	private initSchema(): void {
		this.db.exec(SCHEMA)
	}

	/**
	 * Create a new evaluation run
	 * @param id Run ID
	 * @param benchmark Benchmark name
	 */
	createRun(id: string, benchmark: string): void {
		const stmt = this.db.prepare(`
      INSERT INTO runs (id, timestamp, benchmark)
      VALUES (?, ?, ?)
    `)

		stmt.run(id, Date.now(), benchmark)
	}

	/**
	 * Mark a run as completed
	 * @param id Run ID
	 */
	completeRun(id: string): void {
		const stmt = this.db.prepare(`
      UPDATE runs SET completed = 1 WHERE id = ?
    `)

		stmt.run(id)
	}

	/**
	 * Create a new task
	 * @param id Task ID
	 * @param runId Run ID
	 * @param taskId Original task ID
	 */
	createTask(id: string, runId: string, taskId: string): void {
		const stmt = this.db.prepare(`
      INSERT INTO tasks (id, run_id, task_id, timestamp)
      VALUES (?, ?, ?, ?)
    `)

		stmt.run(id, runId, taskId, Date.now())
	}

	/**
	 * Mark a task as completed
	 * @param id Task ID
	 * @param success Whether the task was successful
	 * @param toolCalls Total tool calls
	 * @param toolFailures Total tool failures
	 */
	completeTask(id: string, success: boolean, toolCalls: number = 0, toolFailures: number = 0): void {
		const stmt = this.db.prepare(`
      UPDATE tasks 
      SET success = ?, total_tool_calls = ?, total_tool_failures = ? 
      WHERE id = ?
    `)

		stmt.run(success ? 1 : 0, toolCalls, toolFailures, id)
	}

	/**
	 * Add a metric to a task
	 * @param taskId Task ID
	 * @param name Metric name
	 * @param value Metric value
	 */
	addMetric(taskId: string, name: string, value: number): void {
		const stmt = this.db.prepare(`
      INSERT INTO metrics (task_id, name, value)
      VALUES (?, ?, ?)
    `)

		stmt.run(taskId, name, value)
	}

	/**
	 * Add a tool call record
	 * @param taskId Task ID
	 * @param toolName Tool name
	 * @param callCount Number of calls
	 * @param failureCount Number of failures
	 */
	addToolCall(taskId: string, toolName: string, callCount: number, failureCount: number): void {
		const stmt = this.db.prepare(`
      INSERT INTO tool_calls (task_id, tool_name, call_count, failure_count)
      VALUES (?, ?, ?, ?)
    `)

		stmt.run(taskId, toolName, callCount, failureCount)
	}

	/**
	 * Add a file record
	 * @param taskId Task ID
	 * @param filePath File path
	 * @param status File status (created, modified, deleted)
	 */
	addFile(taskId: string, filePath: string, status: "created" | "modified" | "deleted"): void {
		const stmt = this.db.prepare(`
      INSERT INTO files (task_id, path, status)
      VALUES (?, ?, ?)
    `)

		stmt.run(taskId, filePath, status)
	}

	/**
	 * Get all runs
	 * @returns Array of runs
	 */
	getRuns(): any[] {
		const stmt = this.db.prepare(`
      SELECT * FROM runs ORDER BY timestamp DESC
    `)

		return stmt.all()
	}

	/**
	 * Get all tasks for a run
	 * @param runId Run ID
	 * @returns Array of tasks
	 */
	getRunTasks(runId: string): any[] {
		const stmt = this.db.prepare(`
      SELECT * FROM tasks WHERE run_id = ? ORDER BY timestamp ASC
    `)

		return stmt.all(runId)
	}

	/**
	 * Get all metrics for a task
	 * @param taskId Task ID
	 * @returns Array of metrics
	 */
	getTaskMetrics(taskId: string): any[] {
		const stmt = this.db.prepare(`
      SELECT name, value FROM metrics WHERE task_id = ?
    `)

		return stmt.all(taskId)
	}

	/**
	 * Get all tool calls for a task
	 * @param taskId Task ID
	 * @returns Array of tool calls
	 */
	getTaskToolCalls(taskId: string): any[] {
		const stmt = this.db.prepare(`
      SELECT tool_name, call_count, failure_count 
      FROM tool_calls 
      WHERE task_id = ?
    `)

		return stmt.all(taskId)
	}

	/**
	 * Get all files for a task
	 * @param taskId Task ID
	 * @returns Array of files
	 */
	getTaskFiles(taskId: string): any[] {
		const stmt = this.db.prepare(`
      SELECT path, status FROM files WHERE task_id = ?
    `)

		return stmt.all(taskId)
	}

	/**
	 * Close the database connection
	 */
	close(): void {
		this.db.close()
	}
}
