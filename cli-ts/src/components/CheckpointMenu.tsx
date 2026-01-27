/**
 * Checkpoint menu component
 * Displays available checkpoints and allows user to select one to restore
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { Box, Text, useInput } from "ink"
import React, { useState } from "react"
import { useStdinContext } from "../context/StdinContext"

export type RestoreType = "task" | "workspace" | "taskAndWorkspace"

interface CheckpointOption {
	ts: number
	hash: string
	date: Date
	label: string
}

interface CheckpointMenuProps {
	messages: ClineMessage[]
	onSelect: (messageTs: number, restoreType: RestoreType) => void
	onCancel: () => void
}

/**
 * Extract checkpoint options from messages
 */
function getCheckpointOptions(messages: ClineMessage[]): CheckpointOption[] {
	const options: CheckpointOption[] = []

	for (const msg of messages) {
		if (msg.lastCheckpointHash) {
			options.push({
				ts: msg.ts,
				hash: msg.lastCheckpointHash,
				date: new Date(msg.ts),
				label: getCheckpointLabel(msg),
			})
		}
	}

	// Sort by timestamp descending (newest first)
	return options.sort((a, b) => b.ts - a.ts)
}

/**
 * Get a human-readable label for a checkpoint
 */
function getCheckpointLabel(msg: ClineMessage): string {
	if (msg.say === "completion_result") {
		return "Task completion"
	}
	if (msg.say === "checkpoint_created") {
		return "Checkpoint"
	}
	if (msg.say === "api_req_started") {
		return "API request"
	}
	return msg.say || msg.ask || "Message"
}

const RESTORE_TYPE_OPTIONS: { type: RestoreType; label: string; description: string }[] = [
	{
		type: "taskAndWorkspace",
		label: "Task + Workspace",
		description: "Restore messages and files",
	},
	{
		type: "task",
		label: "Task Only",
		description: "Delete messages after this point",
	},
	{
		type: "workspace",
		label: "Workspace Only",
		description: "Restore files only",
	},
]

export const CheckpointMenu: React.FC<CheckpointMenuProps> = ({ messages, onSelect, onCancel }) => {
	const { isRawModeSupported } = useStdinContext()
	const checkpoints = getCheckpointOptions(messages)
	const [selectedCheckpoint, setSelectedCheckpoint] = useState(0)
	const [selectedRestoreType, setSelectedRestoreType] = useState(0)
	const [stage, setStage] = useState<"checkpoint" | "restoreType">("checkpoint")

	useInput(
		(input, key) => {
			if (key.escape) {
				if (stage === "restoreType") {
					setStage("checkpoint")
				} else {
					onCancel()
				}
				return
			}

			if (stage === "checkpoint") {
				if (key.upArrow) {
					setSelectedCheckpoint((i) => Math.max(0, i - 1))
				} else if (key.downArrow) {
					setSelectedCheckpoint((i) => Math.min(checkpoints.length - 1, i + 1))
				} else if (key.return && checkpoints.length > 0) {
					setStage("restoreType")
				}
			} else if (stage === "restoreType") {
				if (key.upArrow) {
					setSelectedRestoreType((i) => Math.max(0, i - 1))
				} else if (key.downArrow) {
					setSelectedRestoreType((i) => Math.min(RESTORE_TYPE_OPTIONS.length - 1, i + 1))
				} else if (key.return) {
					const checkpoint = checkpoints[selectedCheckpoint]
					const restoreType = RESTORE_TYPE_OPTIONS[selectedRestoreType]
					if (checkpoint && restoreType) {
						onSelect(checkpoint.ts, restoreType.type)
					}
				}
			}

			// Quick number selection for checkpoints
			if (stage === "checkpoint") {
				const num = parseInt(input, 10)
				if (!Number.isNaN(num) && num >= 1 && num <= checkpoints.length) {
					setSelectedCheckpoint(num - 1)
					setStage("restoreType")
				}
			}
		},
		{ isActive: isRawModeSupported },
	)

	if (checkpoints.length === 0) {
		return (
			<Box borderColor="yellow" borderStyle="round" flexDirection="column" marginTop={1} paddingLeft={1} paddingRight={1}>
				<Text color="yellow">No checkpoints available</Text>
				<Text color="gray">Checkpoints are created at task completion points</Text>
				<Text color="gray">Press Escape to close</Text>
			</Box>
		)
	}

	if (stage === "checkpoint") {
		return (
			<Box borderColor="cyan" borderStyle="round" flexDirection="column" marginTop={1} paddingLeft={1} paddingRight={1}>
				<Text bold color="cyan">
					Restore Checkpoint
				</Text>
				<Text color="gray">Select a checkpoint to restore (↑/↓ or number, Enter to select, Escape to cancel)</Text>
				<Box flexDirection="column" marginTop={1}>
					{checkpoints.map((cp, idx) => {
						const isSelected = idx === selectedCheckpoint
						const timeStr = cp.date.toLocaleTimeString()
						const dateStr = cp.date.toLocaleDateString()
						return (
							<Box key={cp.ts}>
								<Text color={isSelected ? "green" : "gray"}>{isSelected ? "> " : "  "}</Text>
								<Text color={isSelected ? "white" : "gray"}>{idx + 1}. </Text>
								<Text color={isSelected ? "cyan" : undefined}>{cp.label}</Text>
								<Text color="gray">
									{" "}
									- {dateStr} {timeStr}
								</Text>
							</Box>
						)
					})}
				</Box>
			</Box>
		)
	}

	// Stage: restoreType
	const selectedCp = checkpoints[selectedCheckpoint]
	return (
		<Box borderColor="cyan" borderStyle="round" flexDirection="column" marginTop={1} paddingLeft={1} paddingRight={1}>
			<Text bold color="cyan">
				Restore Type
			</Text>
			<Text color="gray">
				Restoring to: {selectedCp?.label} ({selectedCp?.date.toLocaleString()})
			</Text>
			<Box flexDirection="column" marginTop={1}>
				{RESTORE_TYPE_OPTIONS.map((opt, idx) => {
					const isSelected = idx === selectedRestoreType
					return (
						<Box flexDirection="column" key={opt.type} marginBottom={idx < RESTORE_TYPE_OPTIONS.length - 1 ? 1 : 0}>
							<Box>
								<Text color={isSelected ? "green" : "gray"}>{isSelected ? "> " : "  "}</Text>
								<Text bold={isSelected} color={isSelected ? "white" : undefined}>
									{opt.label}
								</Text>
							</Box>
							<Box marginLeft={4}>
								<Text color="gray">{opt.description}</Text>
							</Box>
						</Box>
					)
				})}
			</Box>
			<Text color="gray">(↑/↓ to select, Enter to confirm, Escape to go back)</Text>
		</Box>
	)
}
