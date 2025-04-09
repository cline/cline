import * as http from "http"
import { Logger } from "../../services/logging/Logger"
import { WebviewProvider } from "../../core/webview"

let testServer: http.Server | undefined

/**
 * Creates and starts an HTTP server for test automation
 * @returns The created HTTP server instance
 */
export function createTestServer(): http.Server {
	const PORT = 9876

	testServer = http.createServer((req, res) => {
		// Set CORS headers
		res.setHeader("Access-Control-Allow-Origin", "*")
		res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
		res.setHeader("Access-Control-Allow-Headers", "Content-Type")

		// Handle preflight requests
		if (req.method === "OPTIONS") {
			res.writeHead(204)
			res.end()
			return
		}

		// Only handle POST requests to /task
		if (req.method !== "POST" || req.url !== "/task") {
			res.writeHead(404)
			res.end(JSON.stringify({ error: "Not found" }))
			return
		}

		// Parse the request body
		let body = ""
		req.on("data", (chunk) => {
			body += chunk.toString()
		})

		req.on("end", async () => {
			try {
				// Parse the JSON body
				const { task } = JSON.parse(body)

				if (!task) {
					res.writeHead(400)
					res.end(JSON.stringify({ error: "Missing task parameter" }))
					return
				}

				// Get a visible webview instance
				const visibleWebview = WebviewProvider.getVisibleInstance()
				if (!visibleWebview || !visibleWebview.controller) {
					res.writeHead(500)
					res.end(JSON.stringify({ error: "No active Cline instance found" }))
					return
				}

				// Initiate a new task
				Logger.log(`Test server initiating task: ${task}`)

				try {
					// Clear any existing task
					await visibleWebview.controller.clearTask()

					// Ensure we're in Act mode before initiating the task
					const { chatSettings } = await visibleWebview.controller.getStateToPostToWebview()
					if (chatSettings.mode === "plan") {
						// Switch to Act mode if currently in Plan mode
						await visibleWebview.controller.togglePlanActModeWithChatSettings({ mode: "act" })
					}

					// Initiate the new task
					const taskId = await visibleWebview.controller.initClineWithTask(task)

					// Return success response with the task ID
					res.writeHead(200, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: true, taskId }))
				} catch (error) {
					Logger.log(`Error initiating task: ${error}`)
					res.writeHead(500)
					res.end(JSON.stringify({ error: `Failed to initiate task: ${error}` }))
				}
			} catch (error) {
				res.writeHead(400)
				res.end(JSON.stringify({ error: `Invalid JSON: ${error}` }))
			}
		})
	})

	testServer.listen(PORT, () => {
		Logger.log(`Test server listening on port ${PORT}`)
	})

	// Handle server errors
	testServer.on("error", (error) => {
		Logger.log(`Test server error: ${error}`)
	})

	return testServer
}

/**
 * Shuts down the test server if it exists
 */
export function shutdownTestServer() {
	if (testServer) {
		testServer.close()
		Logger.log("Test server shut down")
		testServer = undefined
	}
}
