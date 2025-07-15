import * as fs from "fs/promises"
import * as fsSync from "fs"
import { SubscribeToFileRequest, FileChangeEvent_ChangeType } from "@shared/proto/host/watch"
import { StreamingResponseHandler, getRequestRegistry } from "@/hosts/vscode/hostbridge-grpc-handler"

// Debounce configuration
const DEBOUNCE_DELAY = 100 // ms

// Keep track of active file watchers
const fileWatchers = new Map<
	string,
	{
		watcher: fsSync.FSWatcher
		subscribers: Set<StreamingResponseHandler>
		lastEventTime: Map<FileChangeEvent_ChangeType, number> // Track last event time by event type
	}
>()

/**
 * Subscribe to file changes
 * @param request The request containing the file path
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToFile(
	request: SubscribeToFileRequest,
	responseStream: StreamingResponseHandler,
	requestId?: string,
): Promise<void> {
	const filePath = request.path
	console.log(`[DEBUG] Setting up file subscription for ${filePath}`)

	try {
		// We don't send an initial event to avoid triggering handlers immediately
		console.log(`[DEBUG] Now watching file: ${filePath}`)

		// Set up or reuse file watcher
		if (!fileWatchers.has(filePath)) {
			// Create a new watcher for this file using Node.js fs.watch API
			// This is more reliable than the VSCode FileSystemWatcher for detecting file saves
			const watcher = fsSync.watch(filePath, { persistent: true }, async (eventType, filename) => {
				if (eventType === "change") {
					try {
						const content = await fs.readFile(filePath, "utf8")
						console.log(`[DEBUG] File changed: ${filePath}`)

						// Get the watcher info
						const watcherInfo = fileWatchers.get(filePath)
						if (watcherInfo) {
							// Check if this event should be debounced
							const eventType = FileChangeEvent_ChangeType.CHANGED
							const now = Date.now()
							const lastTime = watcherInfo.lastEventTime.get(eventType) || 0

							if (now - lastTime < DEBOUNCE_DELAY) {
								console.log(
									`[DEBUG] Debouncing change event for ${filePath} (${now - lastTime}ms since last event)`,
								)
								return // Skip this event due to debounce
							}

							// Update the last event time
							watcherInfo.lastEventTime.set(eventType, now)

							// Notify all subscribers
							for (const subscriber of watcherInfo.subscribers) {
								try {
									await subscriber({
										path: filePath,
										type: eventType,
										content,
									})
								} catch (error) {
									console.error(`Error sending file change event: ${error}`)
									watcherInfo.subscribers.delete(subscriber)
								}
							}
						}
					} catch (error) {
						console.error(`Error reading changed file: ${error}`)
					}
				} else if (eventType === "rename") {
					// In Node.js fs.watch, 'rename' can mean either creation or deletion
					// We need to check if the file exists to determine which it is
					try {
						await fs.access(filePath)
						// File exists, so it was created or renamed
						const content = await fs.readFile(filePath, "utf8")
						console.log(`[DEBUG] File created/renamed: ${filePath}`)

						// Get the watcher info
						const watcherInfo = fileWatchers.get(filePath)
						if (watcherInfo) {
							// Check if this event should be debounced
							const eventType = FileChangeEvent_ChangeType.CREATED
							const now = Date.now()
							const lastTime = watcherInfo.lastEventTime.get(eventType) || 0

							if (now - lastTime < DEBOUNCE_DELAY) {
								console.log(
									`[DEBUG] Debouncing creation event for ${filePath} (${now - lastTime}ms since last event)`,
								)
								return // Skip this event due to debounce
							}

							// Update the last event time
							watcherInfo.lastEventTime.set(eventType, now)

							// Notify all subscribers
							for (const subscriber of watcherInfo.subscribers) {
								try {
									await subscriber({
										path: filePath,
										type: eventType,
										content,
									})
								} catch (error) {
									console.error(`Error sending file creation event: ${error}`)
									watcherInfo.subscribers.delete(subscriber)
								}
							}
						}
					} catch (error) {
						// File doesn't exist, so it was deleted
						console.log(`[DEBUG] File deleted: ${filePath}`)

						// Get the watcher info
						const watcherInfo = fileWatchers.get(filePath)
						if (watcherInfo) {
							// Check if this event should be debounced
							const eventType = FileChangeEvent_ChangeType.DELETED
							const now = Date.now()
							const lastTime = watcherInfo.lastEventTime.get(eventType) || 0

							if (now - lastTime < DEBOUNCE_DELAY) {
								console.log(
									`[DEBUG] Debouncing deletion event for ${filePath} (${now - lastTime}ms since last event)`,
								)
								return // Skip this event due to debounce
							}

							// Update the last event time
							watcherInfo.lastEventTime.set(eventType, now)

							// Notify all subscribers
							for (const subscriber of watcherInfo.subscribers) {
								try {
									await subscriber({
										path: filePath,
										type: eventType,
										content: "",
									})
								} catch (error) {
									console.error(`Error sending file deletion event: ${error}`)
									watcherInfo.subscribers.delete(subscriber)
								}
							}

							// Clean up the watcher
							cleanupWatcher(filePath)
						}
					}
				}
			})

			// Set up the watcher info
			const watcherInfo = {
				watcher,
				subscribers: new Set<StreamingResponseHandler>(),
				lastEventTime: new Map<FileChangeEvent_ChangeType, number>(),
			}

			fileWatchers.set(filePath, watcherInfo)
		}

		// Add this subscriber to the watcher
		const watcherInfo = fileWatchers.get(filePath)!
		watcherInfo.subscribers.add(responseStream)

		// Register cleanup when the connection is closed
		const cleanup = () => {
			console.log(`[DEBUG] Cleaning up file subscription for ${filePath}`)
			const watcherInfo = fileWatchers.get(filePath)
			if (watcherInfo) {
				watcherInfo.subscribers.delete(responseStream)

				// If no subscribers left, clean up the watcher
				if (watcherInfo.subscribers.size === 0) {
					cleanupWatcher(filePath)
				}
			}
		}

		// Register the cleanup function with the request registry
		if (requestId) {
			getRequestRegistry().registerRequest(
				requestId,
				cleanup,
				{ type: "file_subscription", path: filePath },
				responseStream,
			)
		}
	} catch (error) {
		console.error(`Error setting up file subscription: ${error}`)
		// Send an error response
		await responseStream({
			path: filePath,
			type: FileChangeEvent_ChangeType.DELETED,
			content: `Error: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Clean up a file watcher
 * @param filePath The path of the file to clean up
 */
function cleanupWatcher(filePath: string): void {
	const watcherInfo = fileWatchers.get(filePath)
	if (watcherInfo) {
		watcherInfo.watcher.close()
		fileWatchers.delete(filePath)
		console.log(`[DEBUG] Removed file watcher for ${filePath}`)
	}
}
