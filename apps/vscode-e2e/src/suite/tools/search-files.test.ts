import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import type { ClineMessage } from "@roo-code/types"

import { waitFor, sleep } from "../utils"

suite("Roo Code search_files Tool", () => {
	let workspaceDir: string
	let testFiles: {
		jsFile: string
		tsFile: string
		jsonFile: string
		textFile: string
		nestedJsFile: string
		configFile: string
		readmeFile: string
	}

	// Create test files before all tests
	suiteSetup(async () => {
		// Get workspace directory
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			throw new Error("No workspace folder found")
		}
		workspaceDir = workspaceFolders[0]!.uri.fsPath
		console.log("Workspace directory:", workspaceDir)

		// Create test files with different content types
		testFiles = {
			jsFile: path.join(workspaceDir, `test-search-${Date.now()}.js`),
			tsFile: path.join(workspaceDir, `test-search-${Date.now()}.ts`),
			jsonFile: path.join(workspaceDir, `test-config-${Date.now()}.json`),
			textFile: path.join(workspaceDir, `test-readme-${Date.now()}.txt`),
			nestedJsFile: path.join(workspaceDir, "search-test", `nested-${Date.now()}.js`),
			configFile: path.join(workspaceDir, `app-config-${Date.now()}.yaml`),
			readmeFile: path.join(workspaceDir, `README-${Date.now()}.md`),
		}

		// Create JavaScript file with functions
		await fs.writeFile(
			testFiles.jsFile,
			`function calculateTotal(items) {
	return items.reduce((sum, item) => sum + item.price, 0)
}

function validateUser(user) {
	if (!user.email || !user.name) {
		throw new Error("Invalid user data")
	}
	return true
}

// TODO: Add more validation functions
const API_URL = "https://api.example.com"
export { calculateTotal, validateUser }`,
		)

		// Create TypeScript file with interfaces
		await fs.writeFile(
			testFiles.tsFile,
			`interface User {
	id: number
	name: string
	email: string
	isActive: boolean
}

interface Product {
	id: number
	title: string
	price: number
	category: string
}

class UserService {
	async getUser(id: number): Promise<User> {
		// TODO: Implement user fetching
		throw new Error("Not implemented")
	}
	
	async updateUser(user: User): Promise<void> {
		// Implementation here
	}
}

export { User, Product, UserService }`,
		)

		// Create JSON configuration file
		await fs.writeFile(
			testFiles.jsonFile,
			`{
	"name": "test-app",
	"version": "1.0.0",
	"description": "A test application for search functionality",
	"main": "index.js",
	"scripts": {
		"start": "node index.js",
		"test": "jest",
		"build": "webpack"
	},
	"dependencies": {
		"express": "^4.18.0",
		"lodash": "^4.17.21"
	},
	"devDependencies": {
		"jest": "^29.0.0",
		"webpack": "^5.0.0"
	}
}`,
		)

		// Create text file with documentation
		await fs.writeFile(
			testFiles.textFile,
			`# Project Documentation

This is a test project for demonstrating search functionality.

## Features
- User management
- Product catalog
- Order processing
- Payment integration

## Installation
1. Clone the repository
2. Run npm install
3. Configure environment variables
4. Start the application

## API Endpoints
- GET /users - List all users
- POST /users - Create new user
- PUT /users/:id - Update user
- DELETE /users/:id - Delete user

## TODO
- Add authentication
- Implement caching
- Add error handling
- Write more tests`,
		)

		// Create nested directory and file
		await fs.mkdir(path.dirname(testFiles.nestedJsFile), { recursive: true })
		await fs.writeFile(
			testFiles.nestedJsFile,
			`// Nested utility functions
function formatCurrency(amount) {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD'
	}).format(amount)
}

function debounce(func, wait) {
	let timeout
	return function executedFunction(...args) {
		const later = () => {
			clearTimeout(timeout)
			func(...args)
		}
		clearTimeout(timeout)
		timeout = setTimeout(later, wait)
	}
}

module.exports = { formatCurrency, debounce }`,
		)

		// Create YAML config file
		await fs.writeFile(
			testFiles.configFile,
			`# Application Configuration
app:
  name: "Test Application"
  version: "1.0.0"
  port: 3000
  
database:
  host: "localhost"
  port: 5432
  name: "testdb"
  user: "testuser"
  
redis:
  host: "localhost"
  port: 6379
  
logging:
  level: "info"
  file: "app.log"`,
		)

		// Create Markdown README
		await fs.writeFile(
			testFiles.readmeFile,
			`# Search Files Test Project

This project contains various file types for testing the search_files functionality.

## File Types Included

- **JavaScript files** (.js) - Contains functions and exports
- **TypeScript files** (.ts) - Contains interfaces and classes  
- **JSON files** (.json) - Configuration and package files
- **Text files** (.txt) - Documentation and notes
- **YAML files** (.yaml) - Configuration files
- **Markdown files** (.md) - Documentation

## Search Patterns to Test

1. Function definitions: \`function\\s+\\w+\`
2. TODO comments: \`TODO.*\`
3. Import/export statements: \`(import|export).*\`
4. Interface definitions: \`interface\\s+\\w+\`
5. Configuration keys: \`"\\w+":\\s*\`

## Expected Results

The search should find matches across different file types and provide context for each match.`,
		)

		console.log("Test files created successfully")
		console.log("Test files:", testFiles)
	})

	// Clean up after all tests
	suiteTeardown(async () => {
		// Cancel any running tasks before cleanup
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// Task might not be running
		}

		// Clean up all test files
		console.log("Cleaning up test files...")
		for (const [key, filePath] of Object.entries(testFiles)) {
			try {
				await fs.unlink(filePath)
				console.log(`Cleaned up ${key} test file`)
			} catch (error) {
				console.log(`Failed to clean up ${key} test file:`, error)
			}
		}

		// Clean up nested directory
		try {
			const nestedDir = path.join(workspaceDir, "search-test")
			await fs.rmdir(nestedDir)
			console.log("Cleaned up nested directory")
		} catch (error) {
			console.log("Failed to clean up nested directory:", error)
		}
	})

	// Clean up before each test
	setup(async () => {
		// Cancel any previous task
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// Task might not be running
		}

		// Small delay to ensure clean state
		await sleep(100)
	})

	// Clean up after each test
	teardown(async () => {
		// Cancel the current task
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// Task might not be running
		}

		// Small delay to ensure clean state
		await sleep(100)
	})

	test("Should search for function definitions in JavaScript files", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false
		let searchResults: string | null = null

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool execution and capture results
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (text.includes("search_files")) {
					toolExecuted = true
					console.log("search_files tool executed:", text.substring(0, 200))

					// Extract search results from the tool execution
					try {
						const jsonMatch = text.match(/\{"request":".*?"\}/)
						if (jsonMatch) {
							const requestData = JSON.parse(jsonMatch[0])
							if (requestData.request && requestData.request.includes("Result:")) {
								searchResults = requestData.request
								console.log("Captured search results:", searchResults?.substring(0, 300))
							}
						}
					} catch (e) {
						console.log("Failed to parse search results:", e)
					}
				}
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task to search for function definitions
			const jsFileName = path.basename(testFiles.jsFile)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `I have created test files in the workspace including a JavaScript file named "${jsFileName}" that contains function definitions like "calculateTotal" and "validateUser". Use the search_files tool with the regex pattern "function\\s+\\w+" to find all function declarations in JavaScript files. The files exist in the workspace directory.`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed")

			// Verify search results were captured and contain expected content
			assert.ok(searchResults, "Search results should have been captured from tool execution")

			if (searchResults) {
				// Check that results contain function definitions
				const results = searchResults as string
				const hasCalculateTotal = results.includes("calculateTotal")
				const hasValidateUser = results.includes("validateUser")
				const hasFormatCurrency = results.includes("formatCurrency")
				const hasDebounce = results.includes("debounce")
				const hasFunctionKeyword = results.includes("function")
				const hasResults = results.includes("Found") && !results.includes("Found 0")
				const hasAnyExpectedFunction = hasCalculateTotal || hasValidateUser || hasFormatCurrency || hasDebounce

				console.log("Search validation:")
				console.log("- Has calculateTotal:", hasCalculateTotal)
				console.log("- Has validateUser:", hasValidateUser)
				console.log("- Has formatCurrency:", hasFormatCurrency)
				console.log("- Has debounce:", hasDebounce)
				console.log("- Has function keyword:", hasFunctionKeyword)
				console.log("- Has results:", hasResults)
				console.log("- Has any expected function:", hasAnyExpectedFunction)

				assert.ok(hasResults, "Search should return non-empty results")
				assert.ok(hasFunctionKeyword, "Search results should contain 'function' keyword")
				assert.ok(hasAnyExpectedFunction, "Search results should contain at least one expected function name")
			}

			// Verify the AI found function definitions
			const completionMessage = messages.find(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("calculateTotal") ||
						m.text?.includes("validateUser") ||
						m.text?.includes("function")),
			)
			assert.ok(completionMessage, "AI should have found function definitions")

			console.log("Test passed! Function definitions found successfully with validated results")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should search for TODO comments across multiple file types", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool execution
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (text.includes("search_files")) {
					toolExecuted = true
					console.log("search_files tool executed for TODO search")
				}
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task to search for TODO comments
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `I have created test files in the workspace that contain TODO comments in JavaScript, TypeScript, and text files. Use the search_files tool with the regex pattern "TODO.*" to find all TODO items across all file types. The files exist in the workspace directory.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed")

			// Verify the AI found TODO comments
			const completionMessage = messages.find(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("TODO") ||
						m.text?.toLowerCase().includes("found") ||
						m.text?.toLowerCase().includes("results")),
			)
			assert.ok(completionMessage, "AI should have found TODO comments")

			console.log("Test passed! TODO comments found successfully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should search with file pattern filter for TypeScript files", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool execution with file pattern
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (text.includes("search_files") && text.includes("*.ts")) {
					toolExecuted = true
					console.log("search_files tool executed with TypeScript filter")
				}
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task to search for interfaces in TypeScript files only
			const tsFileName = path.basename(testFiles.tsFile)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `I have created test files in the workspace including a TypeScript file named "${tsFileName}" that contains interface definitions like "User" and "Product". Use the search_files tool with the regex pattern "interface\\s+\\w+" and file pattern "*.ts" to find interfaces only in TypeScript files. The files exist in the workspace directory.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed with file pattern
			assert.ok(toolExecuted, "The search_files tool should have been executed with *.ts pattern")

			// Verify the AI found interface definitions
			const completionMessage = messages.find(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("User") || m.text?.includes("Product") || m.text?.includes("interface")),
			)
			assert.ok(completionMessage, "AI should have found interface definitions in TypeScript files")

			console.log("Test passed! TypeScript interfaces found with file pattern filter")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should search for configuration keys in JSON files", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool execution with JSON file pattern
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (text.includes("search_files") && text.includes("*.json")) {
					toolExecuted = true
					console.log("search_files tool executed for JSON configuration search")
				}
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task to search for configuration keys in JSON files
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Search for configuration keys in JSON files. Use the search_files tool with the regex pattern '"\\w+":\\s*' and file pattern "*.json" to find all configuration keys in JSON files.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed with JSON filter")

			// Verify the AI found configuration keys
			const completionMessage = messages.find(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("name") ||
						m.text?.includes("version") ||
						m.text?.includes("scripts") ||
						m.text?.includes("dependencies")),
			)
			assert.ok(completionMessage, "AI should have found configuration keys in JSON files")

			console.log("Test passed! JSON configuration keys found successfully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should search in nested directories", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool execution
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (text.includes("search_files")) {
					toolExecuted = true
					console.log("search_files tool executed for nested directory search")
				}
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task to search in nested directories
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Search for utility functions in the current directory and subdirectories. Use the search_files tool with the regex pattern "function\\s+(format|debounce)" to find utility functions like formatCurrency and debounce.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed")

			// Verify the AI found utility functions in nested directories
			const completionMessage = messages.find(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("formatCurrency") || m.text?.includes("debounce") || m.text?.includes("nested")),
			)
			assert.ok(completionMessage, "AI should have found utility functions in nested directories")

			console.log("Test passed! Nested directory search completed successfully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should handle complex regex patterns", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool execution with complex regex
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (
					text.includes("search_files") &&
					(text.includes("import|export") || text.includes("(import|export)"))
				) {
					toolExecuted = true
					console.log("search_files tool executed with complex regex pattern")
				}
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task to search with complex regex
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Search for import and export statements in JavaScript and TypeScript files. Use the search_files tool with the regex pattern "(import|export).*" and file pattern "*.{js,ts}" to find all import/export statements.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed with complex regex")

			// Verify the AI found import/export statements
			const completionMessage = messages.find(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("export") || m.text?.includes("import") || m.text?.includes("module")),
			)
			assert.ok(completionMessage, "AI should have found import/export statements")

			console.log("Test passed! Complex regex pattern search completed successfully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should handle search with no matches", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false
		let searchResults: string | null = null

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool execution and capture results
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (text.includes("search_files")) {
					toolExecuted = true
					console.log("search_files tool executed for no-match search")

					// Extract search results from the tool execution
					try {
						const jsonMatch = text.match(/\{"request":".*?"\}/)
						if (jsonMatch) {
							const requestData = JSON.parse(jsonMatch[0])
							if (requestData.request && requestData.request.includes("Result:")) {
								searchResults = requestData.request
								console.log("Captured no-match search results:", searchResults?.substring(0, 300))
							}
						}
					} catch (e) {
						console.log("Failed to parse no-match search results:", e)
					}
				}
			}

			// Log all completion messages for debugging
			if (message.type === "say" && (message.say === "completion_result" || message.say === "text")) {
				console.log("AI completion message:", message.text?.substring(0, 300))
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task to search for something that doesn't exist
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Search for a pattern that doesn't exist in any files. Use the search_files tool with the regex pattern "nonExistentPattern12345" to search for something that won't be found.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed")

			// Verify search results were captured and show no matches
			assert.ok(searchResults, "Search results should have been captured from tool execution")

			if (searchResults) {
				// Check that results indicate no matches found
				const results = searchResults as string
				const hasZeroResults = results.includes("Found 0") || results.includes("0 results")
				const hasNoMatches =
					results.toLowerCase().includes("no matches") || results.toLowerCase().includes("no results")
				const indicatesEmpty = hasZeroResults || hasNoMatches

				console.log("No-match search validation:")
				console.log("- Has zero results indicator:", hasZeroResults)
				console.log("- Has no matches indicator:", hasNoMatches)
				console.log("- Indicates empty results:", indicatesEmpty)
				console.log("- Search results preview:", results.substring(0, 200))

				assert.ok(indicatesEmpty, "Search results should indicate no matches were found")
			}

			// Verify the AI provided a completion response (the tool was executed successfully)
			const completionMessage = messages.find(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					m.text &&
					m.text.length > 10, // Any substantial response
			)

			// If we have a completion message, the test passes (AI handled the no-match scenario)
			if (completionMessage) {
				console.log("AI provided completion response for no-match scenario")
			} else {
				// Fallback: check for specific no-match indicators
				const noMatchMessage = messages.find(
					(m) =>
						m.type === "say" &&
						(m.say === "completion_result" || m.say === "text") &&
						(m.text?.toLowerCase().includes("no matches") ||
							m.text?.toLowerCase().includes("not found") ||
							m.text?.toLowerCase().includes("no results") ||
							m.text?.toLowerCase().includes("didn't find") ||
							m.text?.toLowerCase().includes("0 results") ||
							m.text?.toLowerCase().includes("found 0") ||
							m.text?.toLowerCase().includes("empty") ||
							m.text?.toLowerCase().includes("nothing")),
				)
				assert.ok(noMatchMessage, "AI should have provided a response to the no-match search")
			}

			assert.ok(completionMessage, "AI should have provided a completion response")

			console.log("Test passed! No-match scenario handled correctly")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should search for class definitions and methods", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool execution
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (text.includes("search_files") && (text.includes("class") || text.includes("async"))) {
					toolExecuted = true
					console.log("search_files tool executed for class/method search")
				}
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task to search for class definitions and async methods
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Search for class definitions and async methods in TypeScript files. Use the search_files tool with the regex pattern "(class\\s+\\w+|async\\s+\\w+)" and file pattern "*.ts" to find classes and async methods.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed")

			// Verify the AI found class definitions and async methods
			const completionMessage = messages.find(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("UserService") ||
						m.text?.includes("class") ||
						m.text?.includes("async") ||
						m.text?.includes("getUser")),
			)
			assert.ok(completionMessage, "AI should have found class definitions and async methods")

			console.log("Test passed! Class definitions and async methods found successfully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})
})
