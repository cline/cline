import fetch from "node-fetch"
import chalk from "chalk"

/**
 * Send a task to the Cline test server
 * @param task The task description to send
 * @param apiKey Optional Cline API key to use for the task
 * @returns The result of the task execution
 */
export async function sendTaskToServer(task: string, apiKey?: string): Promise<any> {
	const SERVER_URL = "http://localhost:9876/task"

	try {
		console.log(chalk.blue(`Sending task to server: ${task.substring(0, 100)}${task.length > 100 ? "..." : ""}`))

		const response = await fetch(SERVER_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				task,
				apiKey,
			}),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Server responded with status ${response.status}: ${errorText}`)
		}

		const result = await response.json()

		if (!result.success) {
			throw new Error(`Task execution failed: ${result.error || "Unknown error"}`)
		}

		if (result.timeout) {
			throw new Error("Task execution timed out")
		}

		return result
	} catch (error: any) {
		if (error.code === "ECONNREFUSED") {
			throw new Error(
				"Could not connect to the test server. Make sure VSCode is running with the Cline extension and the test server is active.",
			)
		}

		throw error
	}
}
