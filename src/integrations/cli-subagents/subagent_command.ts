import { randomBytes } from "crypto"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

/**
 * Pattern to match simplified AI-Hydro CLI syntax: aihydro "prompt" or aihydro 'prompt'
 * with optional additional flags after the closing quote
 */
const AIHYDRO_COMMAND_PATTERN = /^aihydro\s+(['"])(.+?)\1(\s+.*)?$/

/** Structured context returned by prepareSubagentCommand. */
export interface SubagentJob {
	/** Short hex job identifier used to locate the result dir. */
	jobId: string
	/** Directory where status.json, pid, and result.json are written. */
	resultDir: string
	/** Final shell command to execute (prompt augmented + flags injected). */
	command: string
}

/**
 * Detects if a command is a AI-Hydro CLI subagent command.
 *
 * Matches the simplified syntax: aihydro "prompt" or aihydro 'prompt'
 * This allows the system to apply subagent-specific settings like autonomous execution.
 *
 * @param command - The command string to check
 * @returns True if the command is a AI-Hydro CLI subagent command, false otherwise
 */
export function isSubagentCommand(command: string): boolean {
	// Match simplified syntaxes
	// aihydro "prompt"
	// aihydro 'prompt'
	return AIHYDRO_COMMAND_PATTERN.test(command)
}

/**
 * Prepare a subagent command: generate a job directory, augment the prompt with
 * result-writing instructions, and inject autonomous-execution flags.
 *
 * The subagent is instructed to write a structured JSON result to
 * `resultDir/result.json` using write_to_file before it finishes. The parent
 * reads that file after the process exits to get a typed result instead of
 * scraping plain terminal text.
 *
 * The shell PID of the terminal process is written to `resultDir/pid` by the
 * caller (task/index.ts) once the terminal is created, enabling Python's
 * cancel_job to kill it by PID.
 *
 * @param command - The original aihydro "..." command from the agent
 * @returns SubagentJob with the final command and job metadata, or null if not a subagent command
 */
export function prepareSubagentCommand(command: string): SubagentJob | null {
	if (!isSubagentCommand(command)) {
		return null
	}

	const match = command.match(AIHYDRO_COMMAND_PATTERN)
	if (!match) {
		return null
	}

	const jobId = randomBytes(6).toString("hex") // 12 hex chars, e.g. "a3f7c9d1b2e4"
	const resultDir = path.join(os.homedir(), ".aihydro", "subagents", jobId)
	fs.mkdirSync(resultDir, { recursive: true })

	// Write initial status — readable by Python's jobs.get_job_status(jobId)
	fs.writeFileSync(
		path.join(resultDir, "status.json"),
		JSON.stringify({
			job_id: jobId,
			kind: "cli-subagent",
			status: "pending",
			progress: null,
			partial_results: null,
			error: null,
			log_path: path.join(resultDir, "subagent.log"),
			started_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		}),
	)

	// Augment the prompt with result-writing instructions (no special chars needed).
	// The subagent can use write_to_file for this specific file — exception to no-edit rule.
	const resultPath = path.join(resultDir, "result.json")
	const resultInstruction =
		` After completing your research task, use write_to_file to save your findings as JSON` +
		` to this exact path: ${resultPath}` +
		` — include these fields: summary (1-3 sentence overview), files_read (array of file paths you examined),` +
		` and key_findings (the specific facts, patterns, or answers discovered).` +
		` This is the only file you are permitted to write.`

	const quote = match[1]
	const originalPrompt = match[2]
	const additionalFlags = match[3] || ""
	const augmentedCommand = `aihydro ${quote}${originalPrompt}${resultInstruction}${quote}${additionalFlags}`

	// Apply standard autonomous-execution flags
	const finalCommand = injectSubagentSettings(augmentedCommand)

	return { jobId, resultDir, command: finalCommand }
}

/**
 * Transforms simplified AI-Hydro CLI command syntax with subagent settings.
 *
 * Converts: aihydro "prompt" or aihydro 'prompt'
 * To: aihydro "prompt" -s yolo_mode_toggled=true -s max_consecutive_mistakes=6 -F plain -y --oneshot
 *
 * Preserves additional flags like --workdir:
 * aihydro "prompt" --workdir ./path → aihydro "prompt" -s ... -F plain -y --oneshot --workdir ./path
 *
 * This enables autonomous subagent execution with proper CLI flags for automation.
 *
 * @param command - The command string to potentially transform
 * @returns The transformed command if it matches the pattern, otherwise the original command
 */
export function transformAiHydroCommand(command: string): string {
	if (!isSubagentCommand(command)) {
		return command
	}

	// Inject subagent-specific command structure and settings
	const commandWithSettings = injectSubagentSettings(command)

	return commandWithSettings
}

/**
 * Injects subagent-specific command structure and settings into AI-Hydro CLI commands.
 *
 * @param command - The AI-Hydro CLI command (simplified or full syntax)
 * @returns The command with injected flags and settings
 */
function injectSubagentSettings(command: string): string {
	// No pre-prompt flags needed - use standard "aihydro 'prompt'" syntax
	const prePromptFlags: string[] = []

	// Flags/settings to insert after the prompt
	const postPromptFlags = ["-s yolo_mode_toggled=true", "-s max_consecutive_mistakes=6", "-F plain", "-y", "--oneshot"]

	const match = command.match(AIHYDRO_COMMAND_PATTERN)

	if (match) {
		const quote = match[1]
		const prompt = match[2]
		const additionalFlags = match[3] || ""
		const prePromptPart = prePromptFlags.length > 0 ? prePromptFlags.join(" ") + " " : ""
		return `aihydro ${prePromptPart}${quote}${prompt}${quote} ${postPromptFlags.join(" ")}${additionalFlags}`
	}

	// Already full format: just inject settings after prompt
	const parts = command.split(" ")
	const promptEndIndex = parts.findIndex((p) => p.endsWith('"') || p.endsWith("'"))
	if (promptEndIndex !== -1) {
		parts.splice(promptEndIndex + 1, 0, ...postPromptFlags)
	}
	return parts.join(" ")
}
