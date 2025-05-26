import path from "path"
import os from "os"

import * as vscode from "vscode"
import pWaitFor from "p-wait-for"
import delay from "delay"

import type { ExperimentId } from "@roo-code/types"

import { EXPERIMENT_IDS, experiments as Experiments } from "../../shared/experiments"
import { formatLanguage } from "../../shared/language"
import { defaultModeSlug, getFullModeDetails, getModeBySlug, isToolAllowedForMode } from "../../shared/modes"
import { getApiMetrics } from "../../shared/getApiMetrics"
import { listFiles } from "../../services/glob/list-files"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../integrations/terminal/Terminal"
import { arePathsEqual } from "../../utils/path"
import { formatResponse } from "../prompts/responses"

import { Task } from "../task/Task"

export async function getEnvironmentDetails(cline: Task, includeFileDetails: boolean = false) {
	let details = ""

	const clineProvider = cline.providerRef.deref()
	const state = await clineProvider?.getState()
	const { terminalOutputLineLimit = 500, maxWorkspaceFiles = 200 } = state ?? {}

	// It could be useful for cline to know if the user went from one or no
	// file to another between messages, so we always include this context.
	details += "\n\n# VSCode Visible Files"

	const visibleFilePaths = vscode.window.visibleTextEditors
		?.map((editor) => editor.document?.uri?.fsPath)
		.filter(Boolean)
		.map((absolutePath) => path.relative(cline.cwd, absolutePath))
		.slice(0, maxWorkspaceFiles)

	// Filter paths through rooIgnoreController
	const allowedVisibleFiles = cline.rooIgnoreController
		? cline.rooIgnoreController.filterPaths(visibleFilePaths)
		: visibleFilePaths.map((p) => p.toPosix()).join("\n")

	if (allowedVisibleFiles) {
		details += `\n${allowedVisibleFiles}`
	} else {
		details += "\n(No visible files)"
	}

	details += "\n\n# VSCode Open Tabs"
	const { maxOpenTabsContext } = state ?? {}
	const maxTabs = maxOpenTabsContext ?? 20
	const openTabPaths = vscode.window.tabGroups.all
		.flatMap((group) => group.tabs)
		.map((tab) => (tab.input as vscode.TabInputText)?.uri?.fsPath)
		.filter(Boolean)
		.map((absolutePath) => path.relative(cline.cwd, absolutePath).toPosix())
		.slice(0, maxTabs)

	// Filter paths through rooIgnoreController
	const allowedOpenTabs = cline.rooIgnoreController
		? cline.rooIgnoreController.filterPaths(openTabPaths)
		: openTabPaths.map((p) => p.toPosix()).join("\n")

	if (allowedOpenTabs) {
		details += `\n${allowedOpenTabs}`
	} else {
		details += "\n(No open tabs)"
	}

	// Get task-specific and background terminals.
	const busyTerminals = [
		...TerminalRegistry.getTerminals(true, cline.taskId),
		...TerminalRegistry.getBackgroundTerminals(true),
	]

	const inactiveTerminals = [
		...TerminalRegistry.getTerminals(false, cline.taskId),
		...TerminalRegistry.getBackgroundTerminals(false),
	]

	if (busyTerminals.length > 0) {
		if (cline.didEditFile) {
			await delay(300) // Delay after saving file to let terminals catch up.
		}

		// Wait for terminals to cool down.
		await pWaitFor(() => busyTerminals.every((t) => !TerminalRegistry.isProcessHot(t.id)), {
			interval: 100,
			timeout: 5_000,
		}).catch(() => {})
	}

	// Reset, this lets us know when to wait for saved files to update terminals.
	cline.didEditFile = false

	// Waiting for updated diagnostics lets terminal output be the most
	// up-to-date possible.
	let terminalDetails = ""

	if (busyTerminals.length > 0) {
		// Terminals are cool, let's retrieve their output.
		terminalDetails += "\n\n# Actively Running Terminals"

		for (const busyTerminal of busyTerminals) {
			terminalDetails += `\n## Original command: \`${busyTerminal.getLastCommand()}\``
			let newOutput = TerminalRegistry.getUnretrievedOutput(busyTerminal.id)

			if (newOutput) {
				newOutput = Terminal.compressTerminalOutput(newOutput, terminalOutputLineLimit)
				terminalDetails += `\n### New Output\n${newOutput}`
			}
		}
	}

	// First check if any inactive terminals in this task have completed
	// processes with output.
	const terminalsWithOutput = inactiveTerminals.filter((terminal) => {
		const completedProcesses = terminal.getProcessesWithOutput()
		return completedProcesses.length > 0
	})

	// Only add the header if there are terminals with output.
	if (terminalsWithOutput.length > 0) {
		terminalDetails += "\n\n# Inactive Terminals with Completed Process Output"

		// Process each terminal with output.
		for (const inactiveTerminal of terminalsWithOutput) {
			let terminalOutputs: string[] = []

			// Get output from completed processes queue.
			const completedProcesses = inactiveTerminal.getProcessesWithOutput()

			for (const process of completedProcesses) {
				let output = process.getUnretrievedOutput()

				if (output) {
					output = Terminal.compressTerminalOutput(output, terminalOutputLineLimit)
					terminalOutputs.push(`Command: \`${process.command}\`\n${output}`)
				}
			}

			// Clean the queue after retrieving output.
			inactiveTerminal.cleanCompletedProcessQueue()

			// Add this terminal's outputs to the details.
			if (terminalOutputs.length > 0) {
				terminalDetails += `\n## Terminal ${inactiveTerminal.id}`
				terminalOutputs.forEach((output) => {
					terminalDetails += `\n### New Output\n${output}`
				})
			}
		}
	}

	// console.log(`[Cline#getEnvironmentDetails] terminalDetails: ${terminalDetails}`)

	// Add recently modified files section.
	const recentlyModifiedFiles = cline.fileContextTracker.getAndClearRecentlyModifiedFiles()

	if (recentlyModifiedFiles.length > 0) {
		details +=
			"\n\n# Recently Modified Files\nThese files have been modified since you last accessed them (file was just edited so you may need to re-read it before editing):"
		for (const filePath of recentlyModifiedFiles) {
			details += `\n${filePath}`
		}
	}

	if (terminalDetails) {
		details += terminalDetails
	}

	// Add current time information with timezone.
	const now = new Date()

	const formatter = new Intl.DateTimeFormat(undefined, {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		hour12: true,
	})

	const timeZone = formatter.resolvedOptions().timeZone
	const timeZoneOffset = -now.getTimezoneOffset() / 60 // Convert to hours and invert sign to match conventional notation
	const timeZoneOffsetHours = Math.floor(Math.abs(timeZoneOffset))
	const timeZoneOffsetMinutes = Math.abs(Math.round((Math.abs(timeZoneOffset) - timeZoneOffsetHours) * 60))
	const timeZoneOffsetStr = `${timeZoneOffset >= 0 ? "+" : "-"}${timeZoneOffsetHours}:${timeZoneOffsetMinutes.toString().padStart(2, "0")}`
	details += `\n\n# Current Time\n${formatter.format(now)} (${timeZone}, UTC${timeZoneOffsetStr})`

	// Add context tokens information.
	const { contextTokens, totalCost } = getApiMetrics(cline.clineMessages)
	const { id: modelId, info: modelInfo } = cline.api.getModel()
	const contextWindow = modelInfo.contextWindow

	const contextPercentage =
		contextTokens && contextWindow ? Math.round((contextTokens / contextWindow) * 100) : undefined

	details += `\n\n# Current Context Size (Tokens)\n${contextTokens ? `${contextTokens.toLocaleString()} (${contextPercentage}%)` : "(Not available)"}`
	details += `\n\n# Current Cost\n${totalCost !== null ? `$${totalCost.toFixed(2)}` : "(Not available)"}`

	// Add current mode and any mode-specific warnings.
	const {
		mode,
		customModes,
		customModePrompts,
		experiments = {} as Record<ExperimentId, boolean>,
		customInstructions: globalCustomInstructions,
		language,
	} = state ?? {}

	const currentMode = mode ?? defaultModeSlug

	const modeDetails = await getFullModeDetails(currentMode, customModes, customModePrompts, {
		cwd: cline.cwd,
		globalCustomInstructions,
		language: language ?? formatLanguage(vscode.env.language),
	})

	details += `\n\n# Current Mode\n`
	details += `<slug>${currentMode}</slug>\n`
	details += `<name>${modeDetails.name}</name>\n`
	details += `<model>${modelId}</model>\n`

	if (Experiments.isEnabled(experiments ?? {}, EXPERIMENT_IDS.POWER_STEERING)) {
		details += `<role>${modeDetails.roleDefinition}</role>\n`

		if (modeDetails.customInstructions) {
			details += `<custom_instructions>${modeDetails.customInstructions}</custom_instructions>\n`
		}
	}

	// Add warning if not in code mode.
	if (
		!isToolAllowedForMode("write_to_file", currentMode, customModes ?? [], { apply_diff: cline.diffEnabled }) &&
		!isToolAllowedForMode("apply_diff", currentMode, customModes ?? [], { apply_diff: cline.diffEnabled })
	) {
		const currentModeName = getModeBySlug(currentMode, customModes)?.name ?? currentMode
		const defaultModeName = getModeBySlug(defaultModeSlug, customModes)?.name ?? defaultModeSlug
		details += `\n\nNOTE: You are currently in '${currentModeName}' mode, which does not allow write operations. To write files, the user will need to switch to a mode that supports file writing, such as '${defaultModeName}' mode.`
	}

	if (includeFileDetails) {
		details += `\n\n# Current Workspace Directory (${cline.cwd.toPosix()}) Files\n`
		const isDesktop = arePathsEqual(cline.cwd, path.join(os.homedir(), "Desktop"))

		if (isDesktop) {
			// Don't want to immediately access desktop since it would show
			// permission popup.
			details += "(Desktop files not shown automatically. Use list_files to explore if needed.)"
		} else {
			const maxFiles = maxWorkspaceFiles ?? 200
			const [files, didHitLimit] = await listFiles(cline.cwd, true, maxFiles)
			const { showRooIgnoredFiles = true } = state ?? {}

			const result = formatResponse.formatFilesList(
				cline.cwd,
				files,
				didHitLimit,
				cline.rooIgnoreController,
				showRooIgnoredFiles,
			)

			details += result
		}
	}

	return `<environment_details>\n${details.trim()}\n</environment_details>`
}
