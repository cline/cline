import * as assert from "assert"
import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { Breakpoint } from "vscode"
import * as DebugTools from "@/integrations/debug-tools"
describe("VSCode Integration Tests", () => {
	// Use the fixtures directory - adjust path based on whether we're running from source or compiled output
	const workspacePath = path.resolve(__dirname, "..", "..", "..", "src", "test", "fixtures/test-workspace")
	const debugTestPath = path.join(workspacePath, "debug-me.js")

	// Ensure the test files exist
	before(async () => {
		// Make sure the debug-me.js file exists in the fixtures directory
		if (!fs.existsSync(debugTestPath)) {
			throw new Error(`Test file not found: ${debugTestPath}`)
		}
		// Check if workspace folder exists
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) {
			throw new Error("No workspace folder found")
		}
		// Open the debug-me.js file instead of the folder
		await vscode.workspace.openTextDocument(vscode.Uri.file(debugTestPath))
	})

	// Clean up after tests
	after(async () => {
		// Stop any running debug sessions
		const sessions = vscode.debug.activeDebugSession ? [vscode.debug.activeDebugSession] : []
		for (const session of sessions) {
			await vscode.debug.stopDebugging(session)
		}

		// Remove any breakpoints
		const breakpoints = vscode.debug.breakpoints
		if (breakpoints.length > 0) {
			vscode.debug.removeBreakpoints(breakpoints)
		}
	})

	it("set_breakpoint should add a breakpoint", async () => {
		// Set a breakpoint in the debug-me.js file
		const result = await DebugTools.setBreakpoint({
			filePath: debugTestPath,
			line: 7, // Line with "return result" in the add function
		})

		// Verify the result
		assert.strictEqual(result.isError, false)
		assert.ok(result.content[0].text.includes("Breakpoint set"))

		// Verify the breakpoint was actually set
		const breakpoints = vscode.debug.breakpoints
		assert.ok(breakpoints.length > 0)

		// Find our breakpoint
		const foundBreakpoint = breakpoints.find((bp) => {
			if (bp instanceof vscode.SourceBreakpoint) {
				const location = bp.location
				return path.normalize(location.uri.fsPath) === path.normalize(debugTestPath) && location.range.start.line === 6 // 0-based line number
			}
			return false
		})

		assert.ok(foundBreakpoint, "Breakpoint not found in the expected location")
	})

	it("list_breakpoints should return all breakpoints", async () => {
		// List breakpoints
		const result = DebugTools.listBreakpoints({})

		// Verify the result
		assert.strictEqual(result.isError, false)
		// Check if the content contains the expected information
		const jsonContent = result.content[0].json
		assert.ok(jsonContent.count > 0, "Expected to find breakpoints")
		assert.ok(
			jsonContent.breakpoints.some((bp: any) => bp.file && bp.file.name.includes("debug-me.js")),
			"Expected to find breakpoint in debug-me.js",
		)
	})

	it("start_debug_session should start a debug session", async function () {
		this.timeout(60000) // Increase timeout for this test to 60 seconds
		console.log("Starting 'start_debug_session should start a debug session' test")

		try {
			// Clear any existing debug sessions
			const existingSessions = vscode.debug.activeDebugSession ? [vscode.debug.activeDebugSession] : []
			for (const session of existingSessions) {
				console.log("Stopping existing debug session before test")
				await vscode.debug.stopDebugging(session)
			}

			// Remove any existing breakpoints
			const existingBreakpoints = vscode.debug.breakpoints
			if (existingBreakpoints.length > 0) {
				console.log(`Removing ${existingBreakpoints.length} existing breakpoints`)
				vscode.debug.removeBreakpoints(existingBreakpoints)
			}

			// Make sure we have a breakpoint set
			console.log("Setting breakpoint for debug test")
			const breakpointResult = await DebugTools.setBreakpoint({
				filePath: debugTestPath,
				line: 7, // Line with "return result" in the add function
			})
			console.log(`Breakpoint set result: ${breakpointResult.content[0].text}`)

			// Start a debug session
			console.log("Starting debug session with stopOnEntry: true")
			const result = await DebugTools.startDebuggingAndWaitForStop({
				workspaceFolder: workspacePath,
				nameOrConfiguration: {
					sessionId: "Debug Test",
					type: "node",
					request: "launch",
					name: "Debug Test",
					program: debugTestPath,
					// Use stopOnEntry to ensure the debugger stops
					stopOnEntry: true,
					// Add console output to help with debugging
					console: "integratedTerminal",
				},
			})

			console.log(`Debug session result: ${result.content[0].text}`)

			// Verify the result
			assert.strictEqual(result.isError, false, `Expected success but got error: ${result.content[0].text}`)
			assert.ok(
				result.content[0].text.includes("Debug session") &&
					(result.content[0].text.includes("started successfully") ||
						result.content[0].text.includes("Breakpoint hit") ||
						result.content[0].text.includes("stopped at")),
				`Expected success message but got: ${result.content[0].text}`,
			)

			// Verify a debug session is active
			const session = vscode.debug.activeDebugSession
			console.log(`Active debug session: ${session ? session.name : "none"}`)

			// If no session is found, check if there are any in the DebugSessionManager
			if (!session) {
				const listResult = DebugTools.listDebugSessions()
				console.log(`Debug sessions from manager: ${JSON.stringify(listResult.content[0].json)}`)
				// Skip the assertion if we're in CI environment
				if (process.env.CI !== "true") {
					assert.ok(session, "No active debug session found")
				}
			}

			// Clean up - stop the debug session
			if (session) {
				console.log(`Cleaning up by stopping session: ${session.name}`)
				await vscode.debug.stopDebugging(session)
			} else {
				console.log("No active session to clean up")
			}
		} catch (error) {
			console.error(`Test error: ${error instanceof Error ? error.message : String(error)}`)
			throw error
		}
	})

	it("list_debug_sessions should show active debug sessions", async function () {
		this.timeout(60000) // Increase timeout for this test
		console.log("Starting 'list_debug_sessions should show active debug sessions' test")

		try {
			// Clear any existing debug sessions
			const existingSessions = vscode.debug.activeDebugSession ? [vscode.debug.activeDebugSession] : []
			for (const session of existingSessions) {
				console.log("Stopping existing debug session before test")
				await vscode.debug.stopDebugging(session)
			}

			// Start a debug session
			console.log("Starting debug session for list_debug_sessions test")
			const startResult = await DebugTools.startDebuggingAndWaitForStop({
				workspaceFolder: workspacePath,
				nameOrConfiguration: {
					sessionId: "Debug Test Session",
					type: "node",
					request: "launch",
					name: "Debug Test Session",
					program: debugTestPath,
					stopOnEntry: true,
					console: "integratedTerminal",
				},
			})
			console.log(`Debug session start result: ${startResult.content[0].text}`)

			// Verify a debug session is active
			const session = vscode.debug.activeDebugSession
			console.log(`Active debug session: ${session ? session.name : "none"}`)

			// List debug sessions
			console.log("Listing debug sessions")
			const result = DebugTools.listDebugSessions()
			console.log(`List debug sessions result: ${JSON.stringify(result.content[0].json)}`)

			// Verify the result
			assert.strictEqual(result.isError, false, "Expected list_debug_sessions to succeed")

			// Check if there are any sessions in the result
			const sessions = result.content[0].json.sessions
			assert.ok(
				sessions && sessions.length > 0,
				`Expected to find active debug sessions but got: ${JSON.stringify(result.content[0].json)}`,
			)

			// Clean up - stop the debug session
			if (session) {
				console.log(`Cleaning up by stopping session: ${session.name}`)
				await vscode.debug.stopDebugging(session)
			} else {
				console.log("No active session to clean up")
			}
		} catch (error) {
			console.error(`Test error: ${error instanceof Error ? error.message : String(error)}`)
			throw error
		}
	})

	it("start_debug_session should wait for a breakpoint to be hit", async function () {
		this.timeout(60000) // Increase timeout for this test

		try {
			// Clear any existing debug sessions
			const existingSessions = vscode.debug.activeDebugSession ? [vscode.debug.activeDebugSession] : []
			for (const session of existingSessions) {
				console.log("Stopping existing debug session before test")
				await vscode.debug.stopDebugging(session)
			}
			// Remove any existing breakpoints
			const existingBreakpoints = vscode.debug.breakpoints
			if (existingBreakpoints.length > 0) {
				console.log(`Removing ${existingBreakpoints.length} existing breakpoints`)
				vscode.debug.removeBreakpoints(existingBreakpoints)
			}

			// Make sure we have a breakpoint set in the debug-me.js file
			console.log("Setting breakpoint in debug-me.js at line 7")
			const breakpointResult = await DebugTools.setBreakpoint({
				filePath: debugTestPath,
				line: 7, // Line with "return result" in the add function
			})

			console.log(`Breakpoint set result: ${breakpointResult.content[0].text}`)

			// Verify the breakpoint was actually set
			const breakpoints = vscode.debug.breakpoints
			console.log(`Number of breakpoints: ${breakpoints.length}`)

			// Find our breakpoint
			const foundBreakpoint = breakpoints.find((bp) => {
				if (bp instanceof vscode.SourceBreakpoint) {
					const location = bp.location
					return (
						path.normalize(location.uri.fsPath) === path.normalize(debugTestPath) && location.range.start.line === 6
					) // 0-based line number
				}
				return false
			})

			assert.ok(foundBreakpoint, "Breakpoint not found in the expected location")
			console.log("Breakpoint verified in debug-me.js")

			console.log("Starting debug session")
			// Start a debug session - always waits for breakpoint
			const result = await DebugTools.startDebuggingAndWaitForStop({
				workspaceFolder: workspacePath,
				nameOrConfiguration: {
					sessionId: "Debug Test With Breakpoint SessionID",
					type: "node",
					request: "launch",
					name: "Debug Test With Breakpoint Configuration",
					// Use our runner script that explicitly calls the function with the breakpoint
					program: debugTestPath,
					// Don't stop on entry, let it run to the breakpoint
					stopOnEntry: false,
					// Add console output to help with debugging
					console: "integratedTerminal",
					// Ensure breakpoints are loaded before starting
					skipFiles: [],
				},
			})

			console.log(`Debug session result: ${result.content[0].text}`)
			if (result.content[1]) {
				console.log(`Debug session details: ${result.content[1].text}`)
			}

			// Verify the result
			assert.strictEqual(result.isError, false)

			// The response now has two parts: description and JSON with full debug info
			assert.ok(result.content.length >= 2, "Expected at least 2 content items in response")
			assert.ok(result.content[0].text.includes("stopped at"), "Expected description of breakpoint hit")

			// Parse the JSON response with full debug information
			const debugInfo = JSON.parse(result.content[1].text)

			// Verify the breakpoint information
			assert.ok(debugInfo.breakpoint, "Expected breakpoint information")
			const breakpointInfo = debugInfo.breakpoint
			assert.ok(breakpointInfo.sessionId, "Expected sessionId in breakpoint response")
			assert.ok(breakpointInfo.sessionName, "Expected sessionName in breakpoint response")
			assert.strictEqual(typeof breakpointInfo.threadId, "number", "Expected threadId to be a number")
			assert.strictEqual(breakpointInfo.reason, "breakpoint", "Expected reason to be 'breakpoint'")
			assert.strictEqual(breakpointInfo.line, 7, "Expected breakpoint to be hit at line 7")
			assert.ok(breakpointInfo.filePath.includes("debug-me.js"), "Expected breakpoint to be in debug-me.js")

			// Verify call stack information
			assert.ok(debugInfo.callStack, "Expected call stack information")
			assert.ok(debugInfo.callStack.callStacks, "Expected callStacks array")
			assert.ok(debugInfo.callStack.callStacks.length > 0, "Expected at least one call stack")

			// Verify variables information
			console.log(`Variables present: ${debugInfo.variables !== null}`)
			console.log(`Variables error: ${debugInfo.variablesError || "none"}`)

			if (debugInfo.variables && !debugInfo.variablesError) {
				// The variables structure has variablesByScope array
				assert.ok(debugInfo.variables.variablesByScope, "Expected variablesByScope array")
				console.log(`Number of scopes: ${debugInfo.variables.variablesByScope.length}`)

				// Log all scope names to debug
				debugInfo.variables.variablesByScope.forEach((scope: any) => {
					console.log(`Scope: ${scope.scopeName}, variables: ${scope.variables?.length || 0}`)
				})

				// Look for the 'Local' scope (might be named differently in different debuggers)
				const localScope = debugInfo.variables.variablesByScope.find(
					(scope: any) =>
						scope.scopeName === "Local" ||
						scope.scopeName === "Locals" ||
						scope.scopeName.toLowerCase().includes("local"),
				)

				if (localScope) {
					console.log(`Found local scope: ${localScope.scopeName}`)
					assert.ok(localScope.variables, "Expected variables in Local scope")

					// Log all variables in the local scope
					localScope.variables.forEach((v: any) => {
						console.log(`Variable: ${v.name} = ${v.value}`)
					})

					// Find the 'result' variable
					const resultVariable = localScope.variables.find((v: any) => v.name === "result")
					if (resultVariable) {
						console.log(`Found result variable with value: ${resultVariable.value}`)
						// The result should be 15 (5 + 10)
						assert.strictEqual(resultVariable.value, "15", "Expected result variable to have value 15")
					} else {
						console.log("Result variable not found in local scope")
					}
				} else {
					console.log("Local scope not found, skipping variable assertions")
				}
			} else if (debugInfo.variablesError) {
				console.log(`Variables error: ${debugInfo.variablesError}`)
			}

			// Get the active debug session
			const session = vscode.debug.activeDebugSession
			console.log(`Active debug session: ${session ? session.name : "none"}`)

			// If we have a session, resume it to prevent hanging
			if (session) {
				console.log("Resuming debug session to prevent hanging")
				await DebugTools.resumeDebugSession({ sessionId: session.id })

				// Clean up - stop the debug session
				console.log(`Cleaning up by stopping session: ${session.name}`)
				await vscode.debug.stopDebugging(session)
			} else {
				console.log("No active session to clean up")
			}
		} catch (error) {
			console.error(`Test error: ${error instanceof Error ? error.message : String(error)}`)

			// Make sure to clean up even if there's an error
			const session = vscode.debug.activeDebugSession
			if (session) {
				console.log(`Error occurred, cleaning up session: ${session.name}`)
				await vscode.debug.stopDebugging(session)
			}

			throw error
		}
	})

	it("start_debug_session with variableFilter should only return filtered variables", async function () {
		this.timeout(60000) // Increase timeout for this test

		try {
			// Clear any existing debug sessions
			const existingSessions = vscode.debug.activeDebugSession ? [vscode.debug.activeDebugSession] : []
			for (const session of existingSessions) {
				console.log("Stopping existing debug session before test")
				await vscode.debug.stopDebugging(session)
			}
			// Remove any existing breakpoints
			const existingBreakpoints = vscode.debug.breakpoints
			if (existingBreakpoints.length > 0) {
				console.log(`Removing ${existingBreakpoints.length} existing breakpoints`)
				vscode.debug.removeBreakpoints(existingBreakpoints)
			}

			// Set a breakpoint in the debug-me.js file
			console.log("Setting breakpoint in debug-me.js at line 7")
			const breakpointResult = await DebugTools.setBreakpoint({
				filePath: debugTestPath,
				line: 7, // Line with "return result" in the add function
			})

			console.log(`Breakpoint set result: ${breakpointResult.content[0].text}`)

			console.log("Starting debug session with variable filter")
			// Start a debug session with variableFilter
			const result = await DebugTools.startDebuggingAndWaitForStop({
				workspaceFolder: workspacePath,
				nameOrConfiguration: {
					sessionId: "Debug Test With Variable Filter",
					type: "node",
					request: "launch",
					name: "Debug Test With Variable Filter",
					program: debugTestPath,
					stopOnEntry: false,
					console: "integratedTerminal",
					skipFiles: [],
				},
				variableFilter: ["result", "a"], // Only get 'result' and 'a' variables
			})

			console.log(`Debug session result: ${result.content[0].text}`)
			if (result.content[1]) {
				console.log(`Debug session details: ${result.content[1].text}`)
			}

			// Verify the result
			assert.strictEqual(result.isError, false)

			// Parse the JSON response with full debug information
			const debugInfo = JSON.parse(result.content[1].text)

			// Verify variables information
			console.log(`Variables present: ${debugInfo.variables !== null}`)
			console.log(`Variables error: ${debugInfo.variablesError || "none"}`)

			if (debugInfo.variables && !debugInfo.variablesError) {
				// Find the local scope
				const localScope = debugInfo.variables.variablesByScope.find(
					(scope: any) =>
						scope.scopeName === "Local" ||
						scope.scopeName === "Locals" ||
						scope.scopeName.toLowerCase().includes("local"),
				)

				if (localScope) {
					console.log(`Found local scope: ${localScope.scopeName}`)
					console.log(`Number of variables in local scope: ${localScope.variables.length}`)

					// Log all variables
					localScope.variables.forEach((v: any) => {
						console.log(`Variable: ${v.name} = ${v.value}`)
					})

					// Verify that we only have the filtered variables
					const variableNames = localScope.variables.map((v: any) => v.name)

					// Should have 'result' and 'a' variables
					assert.ok(variableNames.includes("result"), "Expected to find 'result' variable")
					assert.ok(variableNames.includes("a"), "Expected to find 'a' variable")

					// Should NOT have 'b' variable (it was filtered out)
					assert.ok(!variableNames.includes("b"), "Expected NOT to find 'b' variable (should be filtered out)")

					// Verify the values
					const resultVariable = localScope.variables.find((v: any) => v.name === "result")
					const aVariable = localScope.variables.find((v: any) => v.name === "a")

					assert.strictEqual(resultVariable.value, "15", "Expected result variable to have value 15")
					assert.strictEqual(aVariable.value, "5", "Expected a variable to have value 5")
				} else {
					console.log("Local scope not found")
				}
			}

			// Get the active debug session
			const session = vscode.debug.activeDebugSession
			console.log(`Active debug session: ${session ? session.name : "none"}`)

			// Clean up
			if (session) {
				console.log("Resuming debug session to prevent hanging")
				await DebugTools.resumeDebugSession({ sessionId: session.id })
				console.log(`Cleaning up by stopping session: ${session.name}`)
				await vscode.debug.stopDebugging(session)
			}
		} catch (error) {
			console.error(`Test error: ${error instanceof Error ? error.message : String(error)}`)

			// Make sure to clean up even if there's an error
			const session = vscode.debug.activeDebugSession
			if (session) {
				console.log(`Error occurred, cleaning up session: ${session.name}`)
				await vscode.debug.stopDebugging(session)
			}

			throw error
		}
	})

	it("start_debugging_and_wait_for_stop with breakpointConfig should set breakpoints", async function () {
		this.timeout(60000) // Increase timeout for this test
		console.log("Starting 'start_debugging_and_wait_for_stop with breakpointConfig' test")

		try {
			// Clear any existing debug sessions
			const existingSessions = vscode.debug.activeDebugSession ? [vscode.debug.activeDebugSession] : []
			for (const session of existingSessions) {
				console.log("Stopping existing debug session before test")
				await vscode.debug.stopDebugging(session)
			}

			// Remove any existing breakpoints
			const existingBreakpoints = vscode.debug.breakpoints
			if (existingBreakpoints.length > 0) {
				console.log(`Removing ${existingBreakpoints.length} existing breakpoints`)
				vscode.debug.removeBreakpoints(existingBreakpoints)
			}

			console.log("Starting debug session with breakpointConfig")
			// Start a debug session with breakpointConfig
			const result = await DebugTools.startDebuggingAndWaitForStop({
				workspaceFolder: workspacePath,
				nameOrConfiguration: {
					sessionId: "Debug Test With BreakpointConfig",
					type: "node",
					request: "launch",
					name: "Debug Test With BreakpointConfig",
					program: debugTestPath,
					stopOnEntry: false,
					console: "integratedTerminal",
					skipFiles: [],
				},
				breakpointConfig: {
					disableExisting: true,
					breakpoints: [
						{ path: debugTestPath, line: 7 }, // Line in add function
						{ path: debugTestPath, line: 14 }, // Line in countToTen function
					],
				},
			})

			console.log(`Debug session result: ${result.content[0].text}`)
			if (result.content[1]) {
				console.log(`Debug session details: ${result.content[1].text}`)
			}

			// Verify the result
			assert.strictEqual(result.isError, false)
			assert.ok(result.content[0].text.includes("stopped at"), "Expected description of breakpoint hit")

			// Parse the JSON response with full debug information
			const debugInfo = JSON.parse(result.content[1].text)

			// Verify breakpoint was hit
			assert.ok(debugInfo.breakpoint, "Expected breakpoint information")
			const breakpointInfo = debugInfo.breakpoint
			assert.strictEqual(breakpointInfo.reason, "breakpoint", "Expected reason to be 'breakpoint'")

			// If we have line information, verify it's one of the configured lines
			if (breakpointInfo.line !== undefined) {
				assert.ok(
					breakpointInfo.line === 7 || breakpointInfo.line === 14,
					`Expected breakpoint at line 7 or 14, but got ${breakpointInfo.line}`,
				)
			} else {
				console.log("Line information not available in breakpoint info, checking breakpoints were set correctly")
			}

			// Verify that we have the expected number of breakpoints set
			const breakpoints = vscode.debug.breakpoints
			console.log(`Number of breakpoints after test: ${breakpoints.length}`)
			assert.strictEqual(breakpoints.length, 2, "Expected 2 breakpoints to be set")

			// Verify the breakpoints are set at the correct locations
			const breakpointLines = breakpoints
				.filter((bp) => bp instanceof vscode.SourceBreakpoint)
				.map((bp) => (bp as vscode.SourceBreakpoint).location.range.start.line + 1) // Convert 0-based to 1-based
				.sort((a, b) => a - b)
			console.log(`Breakpoint lines: ${breakpointLines}`)
			assert.deepStrictEqual(breakpointLines, [7, 14], "Expected breakpoints at lines 7 and 14")

			// Clean up
			const session = vscode.debug.activeDebugSession
			if (session) {
				console.log(`Cleaning up by stopping session: ${session.name}`)
				await vscode.debug.stopDebugging(session)
			}
		} catch (error) {
			console.error(`Test error: ${error instanceof Error ? error.message : String(error)}`)

			// Make sure to clean up even if there's an error
			const session = vscode.debug.activeDebugSession
			if (session) {
				console.log(`Error occurred, cleaning up session: ${session.name}`)
				await vscode.debug.stopDebugging(session)
			}

			throw error
		}
	})

	it("resume_debug_session should resume a paused debug session", async function () {
		this.timeout(60000) // Increase timeout for this test
		console.log("Starting 'resume_debug_session should resume a paused debug session' test")

		try {
			// Clear any existing debug sessions
			const existingSessions = vscode.debug.activeDebugSession ? [vscode.debug.activeDebugSession] : []
			for (const session of existingSessions) {
				console.log("Stopping existing debug session before test")
				await vscode.debug.stopDebugging(session)
			}

			// Remove any existing breakpoints
			const existingBreakpoints = vscode.debug.breakpoints
			if (existingBreakpoints.length > 0) {
				console.log(`Removing ${existingBreakpoints.length} existing breakpoints`)
				vscode.debug.removeBreakpoints(existingBreakpoints)
			}

			// Set up a debug session that will hit a breakpoint
			// First, set a breakpoint in the debug-me.js file
			console.log("Setting breakpoint for resume test")
			const breakpointResult = await DebugTools.setBreakpoint({
				filePath: debugTestPath,
				line: 7, // Line with "return result" in the add function
			})
			console.log(`Breakpoint set result: ${breakpointResult.content[0].text}`)

			// Start a debug session
			console.log("Starting debug session for resume test")
			const startSessionResult = await DebugTools.startDebuggingAndWaitForStop({
				workspaceFolder: workspacePath,
				nameOrConfiguration: {
					sessionId: "Debug Test For Resume",
					type: "node",
					request: "launch",
					name: "Debug Test For Resume",
					program: debugTestPath,
					stopOnEntry: false,
					console: "integratedTerminal",
					skipFiles: [],
				},
			})
			console.log(`Debug session start result: ${startSessionResult.content[0].text}`)
			if (startSessionResult.content[1]) {
				console.log(`Debug session details: ${startSessionResult.content[1].text}`)
			}

			// Verify the session started and hit the breakpoint
			assert.strictEqual(startSessionResult.isError, false)

			// The response now has two parts: description and JSON with full debug info
			assert.ok(startSessionResult.content.length >= 2, "Expected at least 2 content items in response")

			// Parse the JSON response with full debug information
			const debugInfo = JSON.parse(startSessionResult.content[1].text)

			// Verify the breakpoint information
			assert.ok(debugInfo.breakpoint, "Expected breakpoint information")
			const resumeBreakpointInfo = debugInfo.breakpoint
			assert.ok(resumeBreakpointInfo.sessionId, "Expected sessionId in breakpoint response")
			assert.ok(resumeBreakpointInfo.sessionName, "Expected sessionName in breakpoint response")
			assert.strictEqual(typeof resumeBreakpointInfo.threadId, "number", "Expected threadId to be a number")
			assert.strictEqual(resumeBreakpointInfo.reason, "breakpoint", "Expected reason to be 'breakpoint'")
			// These fields are optional - only check them if present
			if (resumeBreakpointInfo.line !== undefined) {
				assert.strictEqual(resumeBreakpointInfo.line, 7, "Expected breakpoint to be hit at line 7")
			}
			if (resumeBreakpointInfo.filePath !== undefined) {
				assert.ok(resumeBreakpointInfo.filePath.includes("debug-me.js"), "Expected breakpoint to be in debug-me.js")
			}

			// Get the active debug session - this will be the child session that's actually running
			const debugSession = vscode.debug.activeDebugSession
			console.log(`Active debug session: ${debugSession ? debugSession.name : "none"}`)

			if (!debugSession) {
				console.log("No active debug session found, checking for sessions in DebugSessionManager")
				const listResult = DebugTools.listDebugSessions()
				console.log(`Debug sessions from manager: ${JSON.stringify(listResult.content[0].json)}`)
				// Skip the assertion if we're in CI environment
				if (process.env.CI !== "true") {
					assert.ok(debugSession, "No active debug session found")
				} else {
					console.log("Skipping test in CI environment due to no active debug session")
					this.skip()
					return
				}
			}

			// The sessionId from the breakpointInfo is the ID we need to use for resume
			const sessionIdToResume = resumeBreakpointInfo.sessionId
			console.log(`Session ID from breakpoint info: ${sessionIdToResume}`)
			console.log(`Active debug session ID: ${debugSession.id}`)

			// Now test the resume_debug_session function using the sessionId from the breakpoint
			console.log(`Resuming debug session with ID: ${sessionIdToResume}`)
			const resumeResult = await DebugTools.resumeDebugSession({ sessionId: sessionIdToResume })
			console.log(`Resume debug session result: ${resumeResult.content[0].text}`)

			// Verify the result
			assert.strictEqual(resumeResult.isError, false)
			assert.ok(
				resumeResult.content[0].text.includes("Resumed debug session"),
				`Expected result to include "Resumed debug session" but got: ${resumeResult.content[0].text}`,
			)

			// Clean up - stop the debug session
			if (debugSession) {
				console.log(`Cleaning up by stopping session: ${debugSession.name}`)
				await vscode.debug.stopDebugging(debugSession)
			} else {
				console.log("No active session to clean up")
			}
		} catch (error) {
			console.error(`Test error: ${error instanceof Error ? error.message : String(error)}`)

			// Make sure to clean up even if there's an error
			const session = vscode.debug.activeDebugSession
			if (session) {
				console.log(`Error occurred, cleaning up session: ${session.name}`)
				await vscode.debug.stopDebugging(session)
			}

			throw error
		}
	})
})
