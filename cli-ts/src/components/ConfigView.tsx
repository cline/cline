/**
 * Interactive config view component
 * Displays and allows editing of configuration values
 */

import {
	GlobalStateAndSettings,
	GlobalStateAndSettingsKey,
	isSettingsKey,
	LocalState,
	LocalStateKey,
	SETTINGS_DEFAULTS,
} from "@shared/storage/state-keys"
import { Box, Text, useApp, useInput } from "ink"
import React, { useCallback, useMemo, useState } from "react"

// ============================================================================
// Types
// ============================================================================

type ConfigValue = string | number | boolean | object | undefined | null

interface ConfigEntry {
	key: string
	value: ConfigValue
	type: "string" | "number" | "boolean" | "object" | "undefined"
	isEditable: boolean
	source: "global" | "workspace"
}

interface ConfigViewProps {
	dataDir: string
	globalState: Record<string, any>
	workspaceState: Record<string, any>
	onUpdateGlobal?: (key: GlobalStateAndSettingsKey, value: GlobalStateAndSettings[GlobalStateAndSettingsKey]) => void
	onUpdateWorkspace?: (key: LocalStateKey, value: LocalState[LocalStateKey]) => void
}

type ViewMode = "browse" | "edit"

// ============================================================================
// Constants
// ============================================================================

const EXCLUDED_KEYS = [
	"taskHistory",
	"primaryRootIndex",
	"subagentsEnabled",
	"subagentTerminalOutputLineLimit",
	"welcomeViewCompleted",
	"isNewUser",
]

const EDITABLE_TYPES = new Set(["string", "number", "boolean"])

// ============================================================================
// Helper Functions
// ============================================================================

function formatSeparator(char: string = "─", width: number = 80): string {
	return char.repeat(Math.max(width, 10))
}

function getValueType(value: any): ConfigEntry["type"] {
	if (value === undefined || value === null) {
		return "undefined"
	}
	if (typeof value === "boolean") {
		return "boolean"
	}
	if (typeof value === "number") {
		return "number"
	}
	if (typeof value === "object") {
		return "object"
	}
	return "string"
}

function shouldExcludeEntry(key: string, value: any): boolean {
	if (EXCLUDED_KEYS.includes(key)) {
		return true
	}
	if (key.endsWith("Toggles") || key.endsWith("ModelInfo")) {
		return true
	}
	if (key.startsWith("apiConfig_") || key.startsWith("last")) {
		return true
	}
	if (value === undefined || value === null) {
		return true
	}
	if (typeof value === "object" && Object.keys(value).length === 0) {
		return true
	}
	if (Array.isArray(value) && value.length === 0) {
		return true
	}
	if (typeof value === "string" && value.trim() === "") {
		return true
	}
	return false
}

function formatValue(value: ConfigValue, maxLength: number = 50): string {
	if (value === undefined || value === null) {
		return "<not set>"
	}
	if (typeof value === "boolean") {
		return value ? "true" : "false"
	}
	if (typeof value === "number") {
		return String(value)
	}
	if (typeof value === "object") {
		const json = JSON.stringify(value)
		return json.length > maxLength ? json.substring(0, maxLength - 3) + "..." : json
	}
	const str = String(value)
	return str.length > maxLength ? str.substring(0, maxLength - 3) + "..." : str
}

function parseValue(input: string, type: ConfigEntry["type"]): ConfigValue {
	switch (type) {
		case "boolean":
			return input.toLowerCase() === "true" || input === "1"
		case "number": {
			const num = parseFloat(input)
			return Number.isNaN(num) ? 0 : num
		}
		case "object":
			try {
				return JSON.parse(input)
			} catch {
				return {}
			}
		default:
			return input
	}
}

// ============================================================================
// Sub-components
// ============================================================================

interface TextInputProps {
	value: string
	onChange: (value: string) => void
	onSubmit: (value: string) => void
	onCancel: () => void
	label: string
	type: ConfigEntry["type"]
}

const TextInput: React.FC<TextInputProps> = ({ value, onChange, onSubmit, onCancel, label, type }) => {
	useInput((input, key) => {
		if (key.escape) {
			onCancel()
		} else if (key.return) {
			onSubmit(value)
		} else if (key.backspace || key.delete) {
			onChange(value.slice(0, -1))
		} else if (input && !key.ctrl && !key.meta) {
			onChange(value + input)
		}
	})

	return (
		<Box flexDirection="column" marginTop={1}>
			<Text bold color="cyan">
				Edit: {label}
			</Text>
			<Box>
				<Text color="white">{value || ""}</Text>
				<Text color="gray">▌</Text>
			</Box>
			<Text color="gray" dimColor>
				Type: {type} • Enter to save • Esc to cancel
			</Text>
		</Box>
	)
}

interface BooleanSelectProps {
	value: boolean
	onSelect: (value: boolean) => void
	onCancel: () => void
	label: string
}

const BooleanSelect: React.FC<BooleanSelectProps> = ({ value, onSelect, onCancel, label }) => {
	const [selected, setSelected] = useState(value)

	useInput((_input, key) => {
		if (key.escape) {
			onCancel()
		} else if (key.return) {
			onSelect(selected)
		} else if (key.upArrow || key.downArrow) {
			setSelected((prev) => !prev)
		}
	})

	return (
		<Box flexDirection="column" marginTop={1}>
			<Text bold color="cyan">
				Edit: {label}
			</Text>
			<Box flexDirection="column">
				<Text color={selected ? "green" : undefined}>{selected ? "❯ " : "  "}true</Text>
				<Text color={!selected ? "green" : undefined}>{!selected ? "❯ " : "  "}false</Text>
			</Box>
			<Text color="gray" dimColor>
				↑/↓ to toggle • Enter to save • Esc to cancel
			</Text>
		</Box>
	)
}

interface ConfigRowProps {
	entry: ConfigEntry
	isSelected: boolean
}

const ConfigRow: React.FC<ConfigRowProps> = ({ entry, isSelected }) => {
	const valueColor = entry.type === "boolean" ? (entry.value ? "green" : "red") : "white"
	const indicator = isSelected ? "❯ " : "  "
	const editableIndicator = entry.isEditable ? "" : " (read-only)"

	return (
		<Box>
			<Text color={isSelected ? "cyan" : undefined}>
				{indicator}
				<Text color="cyan">{entry.key}</Text>
				<Text color="gray">: </Text>
				<Text color={valueColor}>{formatValue(entry.value)}</Text>
				<Text color="gray" dimColor>
					{editableIndicator}
				</Text>
			</Text>
		</Box>
	)
}

// ============================================================================
// Main Component
// ============================================================================

export const ConfigView: React.FC<ConfigViewProps> = ({
	dataDir,
	globalState,
	workspaceState,
	onUpdateGlobal,
	onUpdateWorkspace,
}) => {
	const { exit } = useApp()
	const [mode, setMode] = useState<ViewMode>("browse")
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [editValue, setEditValue] = useState("")

	// Build entries from state
	const allEntries = useMemo(() => {
		const entries: ConfigEntry[] = []

		// Global state entries
		Object.entries(globalState)
			.filter(([key, value]) => !shouldExcludeEntry(key, value))
			.sort(([a], [b]) => a.localeCompare(b))
			.forEach(([key, value]) => {
				const type = getValueType(value)
				entries.push({
					key,
					value,
					type,
					isEditable: EDITABLE_TYPES.has(type) && isSettingsKey(key),
					source: "global",
				})
			})

		// Workspace state entries
		Object.entries(workspaceState)
			.filter(([key, value]) => !shouldExcludeEntry(key, value))
			.sort(([a], [b]) => a.localeCompare(b))
			.forEach(([key, value]) => {
				const type = getValueType(value)
				entries.push({
					key,
					value,
					type,
					isEditable: EDITABLE_TYPES.has(type),
					source: "workspace",
				})
			})

		return entries
	}, [globalState, workspaceState])

	const selectedEntry = allEntries[selectedIndex]

	// Calculate visible window for scrolling
	const maxVisibleItems = 15
	const halfVisible = Math.floor(maxVisibleItems / 2)
	const startIndex = Math.max(0, Math.min(selectedIndex - halfVisible, allEntries.length - maxVisibleItems))
	const visibleEntries = allEntries.slice(startIndex, startIndex + maxVisibleItems)

	const handleEdit = useCallback(() => {
		if (!selectedEntry || !selectedEntry.isEditable) {
			return
		}
		setEditValue(selectedEntry.value !== undefined ? String(selectedEntry.value) : "")
		setMode("edit")
	}, [selectedEntry])

	const handleSave = useCallback(
		(value: string | boolean) => {
			if (!selectedEntry) {
				return
			}

			const parsedValue = typeof value === "boolean" ? value : parseValue(value, selectedEntry.type)

			if (selectedEntry.source === "global" && onUpdateGlobal) {
				onUpdateGlobal(selectedEntry.key as GlobalStateAndSettingsKey, parsedValue as any)
			} else if (selectedEntry.source === "workspace" && onUpdateWorkspace) {
				onUpdateWorkspace(selectedEntry.key as LocalStateKey, parsedValue as any)
			}

			setMode("browse")
		},
		[selectedEntry, onUpdateGlobal, onUpdateWorkspace],
	)

	const handleCancel = useCallback(() => {
		setMode("browse")
	}, [])

	const handleReset = useCallback(() => {
		if (!selectedEntry || !selectedEntry.isEditable || selectedEntry.source !== "global") {
			return
		}

		const defaultValue = (SETTINGS_DEFAULTS as Record<string, any>)[selectedEntry.key]
		if (defaultValue !== undefined && onUpdateGlobal) {
			onUpdateGlobal(selectedEntry.key as GlobalStateAndSettingsKey, defaultValue)
		}
	}, [selectedEntry, onUpdateGlobal])

	// Input handling for browse mode
	useInput(
		(input, key) => {
			if (key.upArrow) {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : allEntries.length - 1))
			} else if (key.downArrow) {
				setSelectedIndex((prev) => (prev < allEntries.length - 1 ? prev + 1 : 0))
			} else if (key.return || input === "e") {
				handleEdit()
			} else if (input === "r") {
				handleReset()
			} else if (input === "q" || key.escape) {
				exit()
			}
		},
		{ isActive: mode === "browse" },
	)

	// Render editing UI
	if (mode === "edit" && selectedEntry) {
		if (selectedEntry.type === "boolean") {
			return (
				<Box flexDirection="column">
					<Text bold color="white">
						⚙️ Edit Configuration
					</Text>
					<Text color="gray">{formatSeparator()}</Text>
					<BooleanSelect
						label={selectedEntry.key}
						onCancel={handleCancel}
						onSelect={handleSave}
						value={Boolean(selectedEntry.value)}
					/>
				</Box>
			)
		}

		return (
			<Box flexDirection="column">
				<Text bold color="white">
					⚙️ Edit Configuration
				</Text>
				<Text color="gray">{formatSeparator()}</Text>
				<TextInput
					label={selectedEntry.key}
					onCancel={handleCancel}
					onChange={setEditValue}
					onSubmit={handleSave}
					type={selectedEntry.type}
					value={editValue}
				/>
			</Box>
		)
	}

	// Render browse UI
	return (
		<Box flexDirection="column">
			<Text bold color="white">
				⚙️ Cline Configuration
			</Text>
			<Text color="gray">{formatSeparator()}</Text>

			{/* Data directory */}
			<Box>
				<Text>Data directory: </Text>
				<Text color="blue" underline>
					{dataDir}
				</Text>
			</Box>

			<Text color="gray">{formatSeparator()}</Text>

			{/* Scrollable entries */}
			<Box flexDirection="column">
				{visibleEntries.map((entry, idx) => {
					const actualIndex = startIndex + idx
					const isGlobalSection = entry.source === "global"
					const prevEntry = visibleEntries[idx - 1]
					const showSectionHeader = !prevEntry || prevEntry.source !== entry.source

					return (
						<React.Fragment key={`${entry.source}-${entry.key}`}>
							{showSectionHeader && (
								<Box marginTop={idx > 0 ? 1 : 0}>
									<Text bold color="yellow">
										{isGlobalSection ? "Global Settings:" : "Workspace Settings:"}
									</Text>
								</Box>
							)}
							<ConfigRow entry={entry} isSelected={actualIndex === selectedIndex} />
						</React.Fragment>
					)
				})}
			</Box>

			{/* Scroll indicators */}
			{allEntries.length > maxVisibleItems && (
				<Box marginTop={1}>
					<Text color="gray" dimColor>
						{startIndex > 0 ? "↑ " : "  "}
						Showing {startIndex + 1}-{Math.min(startIndex + maxVisibleItems, allEntries.length)} of{" "}
						{allEntries.length}
						{startIndex + maxVisibleItems < allEntries.length ? " ↓" : "  "}
					</Text>
				</Box>
			)}

			<Text color="gray">{formatSeparator()}</Text>

			{/* Help text */}
			<Box flexDirection="column">
				<Text color="gray" dimColor>
					↑/↓ Navigate • Enter/e Edit • r Reset to default • q/Esc Exit
				</Text>
				{selectedEntry && !selectedEntry.isEditable && (
					<Text color="yellow" dimColor>
						This field is read-only ({selectedEntry.type} type or not a setting)
					</Text>
				)}
			</Box>
		</Box>
	)
}
