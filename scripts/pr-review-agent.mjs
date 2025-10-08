#!/usr/bin/env node

/**
 * PR Review Agent
 * Uses Claude Agent SDK for fully AI-powered code review
 */

import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import Anthropic from "@anthropic-ai/sdk"

// Get environment variables
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY
const PR_NUMBER = process.env.PR_NUMBER
const HEAD_SHA = process.env.HEAD_SHA

if (!ANTHROPIC_API_KEY) {
	console.error("Error: ANTHROPIC_API_KEY environment variable is required")
	process.exit(1)
}

if (!GITHUB_TOKEN) {
	console.error("Error: GITHUB_TOKEN environment variable is required")
	process.exit(1)
}

if (!GITHUB_REPOSITORY || !PR_NUMBER || !HEAD_SHA) {
	console.error("Error: GitHub environment variables missing")
	process.exit(1)
}

const [owner, repo] = GITHUB_REPOSITORY.split("/")

// Set GH_TOKEN for gh CLI
process.env.GH_TOKEN = GITHUB_TOKEN

console.log(`Starting AI-powered review for ${GITHUB_REPOSITORY}#${PR_NUMBER}`)

// Initialize Anthropic client
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

// Helper functions
function safeJoin(p) {
	const abs = path.resolve(process.cwd(), p)
	return abs.startsWith(process.cwd()) ? abs : null
}

function execCommand(cmd) {
	try {
		return execSync(cmd, { encoding: "utf8" })
	} catch (error) {
		console.error(`Command failed: ${cmd}`)
		console.error(error.message)
		throw error
	}
}

// Tool definitions for Claude
const tools = [
	{
		name: "get_pr_diff",
		description: "Get unified diffs for all changed files in the PR. Returns patches showing what was added/removed.",
		input_schema: {
			type: "object",
			properties: {},
			required: [],
		},
	},
	{
		name: "get_changed_files",
		description: "List all files changed in the PR with their status (added, modified, deleted) and change counts.",
		input_schema: {
			type: "object",
			properties: {},
			required: [],
		},
	},
	{
		name: "list_directory",
		description: "List files and directories at a path relative to repo root. Use this to explore the project structure.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Directory path relative to repo root (default: '.')",
					default: ".",
				},
			},
			required: [],
		},
	},
	{
		name: "read_file",
		description: "Read the full contents of a file from the repository. Use this to understand context around changes.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "File path relative to repo root",
				},
				start: {
					type: "integer",
					description: "Optional: Start byte position for large files",
					minimum: 0,
				},
				end: {
					type: "integer",
					description: "Optional: End byte position for large files",
					minimum: 0,
				},
			},
			required: ["path"],
		},
	},
	{
		name: "post_inline_comment",
		description:
			"Post an inline review comment on a specific line in the PR. Line numbers refer to the NEW version of the file (after changes). Use this to flag specific issues you find.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "File path relative to repo root",
				},
				line: {
					type: "integer",
					description: "Line number in the NEW version of the file",
					minimum: 1,
				},
				body: {
					type: "string",
					description: "Comment text - be specific and actionable",
				},
			},
			required: ["path", "line", "body"],
		},
	},
	{
		name: "post_review_summary",
		description:
			"Post an overall review summary. Use this once at the end after posting any inline comments. Choose APPROVE if no issues, COMMENT if minor issues, REQUEST_CHANGES if serious issues.",
		input_schema: {
			type: "object",
			properties: {
				body: {
					type: "string",
					description: "Overall review summary text",
				},
				event: {
					type: "string",
					description: "Review event type",
					enum: ["APPROVE", "COMMENT", "REQUEST_CHANGES"],
				},
			},
			required: ["body", "event"],
		},
	},
]

// Tool handlers
async function handleToolCall(toolName, toolInput) {
	console.log(`Tool call: ${toolName}`, JSON.stringify(toolInput, null, 2))

	switch (toolName) {
		case "get_pr_diff": {
			const output = execCommand(`gh api repos/${owner}/${repo}/pulls/${PR_NUMBER}/files?per_page=100`)
			const files = JSON.parse(output)
			return {
				diffs: files
					.filter((f) => f.patch && f.status !== "removed")
					.map((f) => ({
						path: f.filename,
						status: f.status,
						additions: f.additions,
						deletions: f.deletions,
						patch: f.patch,
					})),
			}
		}

		case "get_changed_files": {
			const output = execCommand(`gh api repos/${owner}/${repo}/pulls/${PR_NUMBER}/files?per_page=100`)
			const files = JSON.parse(output)
			return files.map((f) => ({
				path: f.filename,
				status: f.status,
				additions: f.additions,
				deletions: f.deletions,
			}))
		}

		case "list_directory": {
			const dirPath = toolInput.path || "."
			const abs = safeJoin(dirPath)
			if (!abs) return { error: "Path outside repository" }

			const entries = fs.readdirSync(abs, { withFileTypes: true })
			return {
				entries: entries.map((d) => ({
					name: d.name,
					type: d.isDirectory() ? "dir" : "file",
				})),
			}
		}

		case "read_file": {
			const filePath = toolInput.path
			const abs = safeJoin(filePath)
			if (!abs) return { error: "Path outside repository" }

			if (!fs.existsSync(abs)) return { error: "File not found" }
			if (fs.statSync(abs).isDirectory()) return { error: "Path is a directory" }

			let buf = fs.readFileSync(abs)
			const start = Math.max(0, toolInput.start || 0)
			const end = toolInput.end ? Math.min(buf.length, toolInput.end) : buf.length
			buf = buf.subarray(start, end)

			// Limit to avoid huge payloads
			const MAX = 200000
			const truncated = buf.length > MAX
			if (truncated) buf = buf.subarray(0, MAX)

			return {
				content: buf.toString("utf8"),
				start,
				end: start + buf.length,
				truncated,
			}
		}

		case "post_inline_comment": {
			const { path: filePath, line, body } = toolInput

			const review = {
				commit_id: HEAD_SHA,
				event: "COMMENT",
				comments: [
					{
						path: filePath,
						line: line,
						side: "RIGHT",
						body: body,
					},
				],
			}

			const reviewFile = `/tmp/review-${Date.now()}.json`
			fs.writeFileSync(reviewFile, JSON.stringify(review))

			try {
				execCommand(`gh api repos/${owner}/${repo}/pulls/${PR_NUMBER}/reviews --method POST --input ${reviewFile}`)
				console.log(`✓ Posted comment on ${filePath}:${line}`)
				return { success: true }
			} finally {
				try {
					fs.unlinkSync(reviewFile)
				} catch (e) {
					// Ignore cleanup errors
				}
			}
		}

		case "post_review_summary": {
			const { body, event } = toolInput

			const eventFlag = event === "APPROVE" ? "--approve" : event === "REQUEST_CHANGES" ? "--request-changes" : "--comment"

			execCommand(`gh pr review ${PR_NUMBER} --repo ${owner}/${repo} ${eventFlag} --body "${body.replace(/"/g, '\\"')}"`)

			console.log(`✓ Posted review summary with event: ${event}`)
			return { success: true, event }
		}

		default:
			return { error: `Unknown tool: ${toolName}` }
	}
}

// System prompt for the AI code reviewer
const SYSTEM_PROMPT = `You are an expert code reviewer for the Cline project - an AI-powered coding assistant built as a VSCode extension.

Your role is to autonomously review pull requests by:
1. Understanding what changed and why
2. Identifying bugs, security issues, and code quality problems
3. Checking architectural decisions and design patterns
4. Ensuring code follows best practices
5. Navigating the codebase to understand context when needed

Technical context about Cline:
- TypeScript/JavaScript codebase with VSCode extension
- Uses gRPC and Protocol Buffers for communication
- Has a React webview UI
- Integrates with various AI providers (Anthropic, OpenAI, etc.)
- Uses Model Context Protocol (MCP) for extensibility

Review approach:
1. Start by getting the PR diff and changed files list
2. For each changed file, understand what it does by reading the full file if needed
3. Navigate to related files to understand the broader context
4. Use your AI intelligence to identify:
   - Logic errors and bugs
   - Security vulnerabilities (SQL injection, XSS, credential leaks, etc.)
   - Race conditions and concurrency issues
   - Memory leaks and resource management issues
   - Breaking API changes
   - Missing error handling
   - Poor code organization or unclear logic
   - Performance issues
   - Accessibility problems (for UI code)
5. Post specific inline comments on lines that need attention
6. Provide an overall review summary at the end

Guidelines:
- Focus on meaningful issues that could cause real problems
- Be constructive and specific in your feedback
- Suggest concrete fixes when possible
- Don't nitpick style unless it affects readability
- If something is unclear, read more files to understand context
- Consider the full impact of changes, not just local effects

When you're done reviewing, call post_review_summary with:
- APPROVE: No significant issues found
- COMMENT: Minor issues that should be addressed but don't block merge
- REQUEST_CHANGES: Serious issues that must be fixed before merge

Begin by calling get_pr_diff to see what changed in this PR.`

// Main agent loop
async function runAgent() {
	const messages = [
		{
			role: "user",
			content: `Review pull request #${PR_NUMBER} for repository ${GITHUB_REPOSITORY}. The PR is at commit ${HEAD_SHA}. Start by examining what changed.`,
		},
	]

	let continueLoop = true
	let iterationCount = 0
	const maxIterations = 25 // Safety limit

	while (continueLoop && iterationCount < maxIterations) {
		iterationCount++
		console.log(`\n=== Agent iteration ${iterationCount} ===`)

		const response = await anthropic.messages.create({
			model: "claude-3-5-sonnet-latest",
			max_tokens: 4096,
			system: SYSTEM_PROMPT,
			tools: tools,
			messages: messages,
		})

		console.log(`Stop reason: ${response.stop_reason}`)

		// Add assistant response to messages
		messages.push({
			role: "assistant",
			content: response.content,
		})

		// Check if we're done
		if (response.stop_reason === "end_turn") {
			console.log("\n✓ Agent completed review")
			continueLoop = false
			break
		}

		// Handle tool uses
		if (response.stop_reason === "tool_use") {
			const toolResults = []

			for (const block of response.content) {
				if (block.type === "tool_use") {
					try {
						const result = await handleToolCall(block.name, block.input)
						toolResults.push({
							type: "tool_result",
							tool_use_id: block.id,
							content: JSON.stringify(result),
						})
					} catch (error) {
						console.error(`Error in tool ${block.name}:`, error.message)
						toolResults.push({
							type: "tool_result",
							tool_use_id: block.id,
							content: JSON.stringify({ error: error.message }),
							is_error: true,
						})
					}
				}
			}

			// Add tool results to messages
			messages.push({
				role: "user",
				content: toolResults,
			})
		} else {
			// Unexpected stop reason
			console.log("Unexpected stop reason, ending loop")
			continueLoop = false
		}
	}

	if (iterationCount >= maxIterations) {
		console.log("\n⚠️ Reached maximum iteration limit")
		// Post a summary indicating incomplete review
		await handleToolCall("post_review_summary", {
			body: "⚠️ Review incomplete: Reached iteration limit. Please review manually.",
			event: "COMMENT",
		})
	}

	console.log(`\n✓ Review completed after ${iterationCount} iterations`)
}

// Run the agent
runAgent().catch((error) => {
	console.error("Fatal error:", error)
	process.exit(1)
})
