#!/usr/bin/env node
/**
 * Cline Message Listener - Improved Version
 *
 * Monitors the message queue for messages from Claude Code and processes them.
 * This version includes proper queue buffering to handle rapid fire messages.
 */

const fs = require("fs")
const path = require("path")

// Message queue paths
const QUEUE_DIR = path.join(__dirname, ".message-queue")
const INBOX_DIR = path.join(QUEUE_DIR, "inbox")
const OUTBOX_DIR = path.join(QUEUE_DIR, "outbox")
const RESPONSES_DIR = path.join(QUEUE_DIR, "responses")

// Processing queue to handle rapid fire messages
const processingQueue = []
let isProcessing = false
const processedFiles = new Set()

// Ensure directories exist
function ensureDirectories() {
	;[QUEUE_DIR, INBOX_DIR, OUTBOX_DIR, RESPONSES_DIR].forEach((dir) => {
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}
	})
}

// Process a message
async function processMessage(messageFile) {
	// Prevent duplicate processing
	if (processedFiles.has(messageFile)) {
		return
	}
	processedFiles.add(messageFile)

	try {
		const filePath = path.join(INBOX_DIR, messageFile)

		// Check if file still exists
		if (!fs.existsSync(filePath)) {
			processedFiles.delete(messageFile)
			return
		}

		const content = fs.readFileSync(filePath, "utf8")
		const message = JSON.parse(content)

		console.log(`\n📨 Received message from ${message.from}:`)
		console.log(`   ID: ${message.id}`)
		console.log(`   Type: ${message.type}`)
		console.log(`   Content: ${message.content}`)

		// Simulate processing (integrate with Cline's actual processing later)
		const response = {
			id: generateId(),
			from: "cline",
			to: message.from,
			timestamp: new Date().toISOString(),
			type: "response",
			content: `Cline received your message: "${message.content}"`,
			metadata: {
				replyTo: message.id,
			},
		}

		// Write response
		const responseFileName = `${Date.now()}_${response.id.substring(0, 8)}.json`
		const responsePath = path.join(RESPONSES_DIR, responseFileName)
		fs.writeFileSync(responsePath, JSON.stringify(response, null, 2))

		console.log(`✅ Response sent: ${response.content}`)

		// Delete processed message
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath)
			console.log(`🗑️  Cleaned up message file`)
		}

		// Clean up from tracking after a delay
		setTimeout(() => {
			processedFiles.delete(messageFile)
		}, 5000)
	} catch (error) {
		console.error(`❌ Error processing message ${messageFile}:`, error.message)
		processedFiles.delete(messageFile)
	}
}

// Queue processor - processes messages one at a time
async function processQueue() {
	if (isProcessing || processingQueue.length === 0) {
		return
	}

	isProcessing = true

	while (processingQueue.length > 0) {
		const messageFile = processingQueue.shift()
		await processMessage(messageFile)
		// Small delay to prevent overwhelming the system
		await new Promise((resolve) => setTimeout(resolve, 50))
	}

	isProcessing = false
}

// Add message to queue
function enqueueMessage(filename) {
	if (!filename || !filename.endsWith(".json")) {
		return
	}

	// Check if already in queue or processed
	if (processingQueue.includes(filename) || processedFiles.has(filename)) {
		return
	}

	processingQueue.push(filename)
	console.log(`📥 Queued: ${filename} (queue size: ${processingQueue.length})`)
	processQueue()
}

// Scan inbox for messages
function scanInbox() {
	try {
		const files = fs.readdirSync(INBOX_DIR).filter((f) => f.endsWith(".json"))
		files.forEach((file) => {
			enqueueMessage(file)
		})
	} catch (error) {
		console.error("Error scanning inbox:", error.message)
	}
}

// Watch inbox for new messages
function watchInbox() {
	console.log(`\n👂 Cline Message Listener (Improved) started`)
	console.log(`   Watching: ${INBOX_DIR}`)
	console.log(`   Queue-based processing enabled`)
	console.log(`   Press Ctrl+C to stop\n`)

	// Process existing messages
	scanInbox()

	// Scan periodically to catch any missed files
	setInterval(scanInbox, 1000)

	// Watch for new messages
	fs.watch(INBOX_DIR, (eventType, filename) => {
		if (filename && filename.endsWith(".json")) {
			// Wait a bit to ensure file is fully written
			setTimeout(() => {
				if (fs.existsSync(path.join(INBOX_DIR, filename))) {
					enqueueMessage(filename)
				}
			}, 100)
		}
	})
}

// Send a message to Claude Code
function sendMessage(content, type = "notification", replyTo = null) {
	ensureDirectories()

	const message = {
		id: generateId(),
		from: "cline",
		to: "claude-code",
		timestamp: new Date().toISOString(),
		type: type,
		content: content,
		metadata: {},
	}

	if (replyTo) {
		message.metadata.replyTo = replyTo
	}

	const filename = `${Date.now()}_${message.id.substring(0, 8)}.json`
	const filepath = path.join(OUTBOX_DIR, filename)

	fs.writeFileSync(filepath, JSON.stringify(message, null, 2))

	console.log(`📤 Message sent to Claude Code`)
	console.log(`   ID: ${message.id}`)
	console.log(`   Content: ${content}`)

	return message.id
}

// Generate a simple UUID
function generateId() {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0
		const v = c === "x" ? r : (r & 0x3) | 0x8
		return v.toString(16)
	})
}

// Cleanup old messages (older than 1 hour)
function cleanupOldMessages() {
	const oneHourAgo = Date.now() - 60 * 60 * 1000

	;[INBOX_DIR, OUTBOX_DIR, RESPONSES_DIR].forEach((dir) => {
		if (!fs.existsSync(dir)) return

		const files = fs.readdirSync(dir)
		files.forEach((file) => {
			const filePath = path.join(dir, file)
			const stats = fs.statSync(filePath)

			if (stats.mtimeMs < oneHourAgo) {
				fs.unlinkSync(filePath)
				console.log(`🗑️  Cleaned up old message: ${file}`)
			}
		})
	})
}

// Main
function main() {
	ensureDirectories()

	// Run cleanup every 10 minutes
	setInterval(cleanupOldMessages, 10 * 60 * 1000)

	// Start watching for messages
	watchInbox()
}

// Export for use as a module
if (require.main === module) {
	main()
} else {
	module.exports = {
		sendMessage,
		watchInbox,
		ensureDirectories,
	}
}
