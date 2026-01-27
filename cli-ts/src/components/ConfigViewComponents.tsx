/**
 * Sub-components and types for ConfigView
 */

import { Box, Text, useInput } from "ink"
import React, { useState } from "react"
import { useStdinContext } from "../context/StdinContext"

// ============================================================================
// Types & Constants
// ============================================================================

export type ValueType = "string" | "number" | "boolean" | "object" | "undefined"
export type TabView = "settings" | "rules" | "workflows" | "hooks" | "skills"

export interface ConfigEntry {
	key: string
	value: unknown
	type: ValueType
	isEditable: boolean
	source: "global" | "workspace"
}

export interface ToggleEntry {
	path: string
	enabled: boolean
	source: "global" | "workspace" | "remote"
	ruleType?: string
}

export interface HookInfo {
	name: string
	enabled: boolean
	absolutePath: string
}

export interface WorkspaceHooks {
	workspaceName: string
	hooks: HookInfo[]
}

export interface SkillInfo {
	name: string
	description: string
	path: string
	enabled: boolean
}

export const EXCLUDED_KEYS = new Set([
	"taskHistory",
	"primaryRootIndex",
	"subagentsEnabled",
	"subagentTerminalOutputLineLimit",
	"welcomeViewCompleted",
	"isNewUser",
])

export const EDITABLE_TYPES: Set<ValueType> = new Set(["string", "number", "boolean"])
export const MAX_VISIBLE = 12
export const SEPARATOR = "─".repeat(80)

export const TABS: { key: TabView; label: string; requiresFlag?: "hooks" | "skills" }[] = [
	{ key: "settings", label: "Settings" },
	{ key: "rules", label: "Rules" },
	{ key: "workflows", label: "Workflows" },
	{ key: "hooks", label: "Hooks", requiresFlag: "hooks" },
	{ key: "skills", label: "Skills", requiresFlag: "skills" },
]

// ============================================================================
// Helper Functions
// ============================================================================

export function getValueType(value: unknown): ValueType {
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

export function isExcluded(key: string, value: unknown): boolean {
	if (EXCLUDED_KEYS.has(key)) {
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
	if (typeof value === "object" && Object.keys(value as object).length === 0) {
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

export function formatValue(value: unknown, maxLen = 50): string {
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
		return json.length > maxLen ? json.slice(0, maxLen - 3) + "..." : json
	}
	const str = String(value)
	return str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str
}

export function parseValue(input: string, type: ValueType): unknown {
	if (type === "boolean") {
		return input.toLowerCase() === "true" || input === "1"
	}
	if (type === "number") {
		const num = parseFloat(input)
		return Number.isNaN(num) ? 0 : num
	}
	if (type === "object") {
		try {
			return JSON.parse(input)
		} catch {
			return {}
		}
	}
	return input
}

// Import isSettingsKey at module level for proper test mocking
import { isSettingsKey } from "@shared/storage/state-keys"

export function buildConfigEntries(state: Record<string, unknown>, source: "global" | "workspace"): ConfigEntry[] {
	return Object.entries(state)
		.filter(([key, value]) => !isExcluded(key, value))
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => {
			const type = getValueType(value)
			const isEditable = EDITABLE_TYPES.has(type) && (source === "workspace" || isSettingsKey(key))
			return { key, value, type, isEditable, source }
		})
}

export function buildToggleEntries(
	toggles: Record<string, boolean> | undefined,
	source: "global" | "workspace" | "remote",
	ruleType?: string,
): ToggleEntry[] {
	if (!toggles) {
		return []
	}
	return Object.entries(toggles)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([path, enabled]) => ({ path, enabled, source, ruleType }))
}

export function getFileName(path: string): string {
	return path.split("/").pop() || path
}

// ============================================================================
// Sub-components
// ============================================================================

interface TextInputProps {
	label: string
	onChange: (value: string) => void
	onCancel: () => void
	onSubmit: (value: string) => void
	type: ValueType
	value: string
}

export const TextInput: React.FC<TextInputProps> = ({ label, onChange, onCancel, onSubmit, type, value }) => {
	const { isRawModeSupported } = useStdinContext()

	useInput(
		(input, key) => {
			if (key.escape) {
				onCancel()
			} else if (key.return) {
				onSubmit(value)
			} else if (key.backspace || key.delete) {
				onChange(value.slice(0, -1))
			} else if (input && !key.ctrl && !key.meta) {
				onChange(value + input)
			}
		},
		{ isActive: isRawModeSupported },
	)

	return (
		<Box flexDirection="column" marginTop={1}>
			<Text bold color="cyan">
				Edit: {label}
			</Text>
			<Box>
				<Text color="white">{value}</Text>
				<Text inverse> </Text>
			</Box>
			<Text color="gray">Type: {type} • Enter to save • Esc to cancel</Text>
		</Box>
	)
}

interface BooleanSelectProps {
	label: string
	onCancel: () => void
	onSelect: (value: boolean) => void
	value: boolean
}

export const BooleanSelect: React.FC<BooleanSelectProps> = ({ label, onCancel, onSelect, value }) => {
	const { isRawModeSupported } = useStdinContext()
	const [selected, setSelected] = useState(value)

	useInput(
		(_input, key) => {
			if (key.escape) {
				onCancel()
			} else if (key.return) {
				onSelect(selected)
			} else if (key.upArrow || key.downArrow) {
				setSelected((prev) => !prev)
			}
		},
		{ isActive: isRawModeSupported },
	)

	return (
		<Box flexDirection="column" marginTop={1}>
			<Text bold color="cyan">
				Edit: {label}
			</Text>
			<Box flexDirection="column">
				<Text color={selected ? "green" : undefined}>{selected ? "❯ " : "  "}true</Text>
				<Text color={!selected ? "green" : undefined}>{!selected ? "❯ " : "  "}false</Text>
			</Box>
			<Text color="gray">↑/↓ to toggle • Enter to save • Esc to cancel</Text>
		</Box>
	)
}

export const ConfigRow: React.FC<{ entry: ConfigEntry; isSelected: boolean }> = ({ entry, isSelected }) => {
	const valueColor = entry.type === "boolean" ? (entry.value ? "green" : "red") : "white"

	return (
		<Box>
			<Text color={isSelected ? "cyan" : undefined}>
				{isSelected ? "❯ " : "  "}
				<Text color="cyan">{entry.key}</Text>
				<Text color="gray">: </Text>
				<Text color={valueColor}>{formatValue(entry.value)}</Text>
				{!entry.isEditable && <Text color="gray"> (read-only)</Text>}
			</Text>
		</Box>
	)
}

export const ToggleRow: React.FC<{
	entry: ToggleEntry
	isSelected: boolean
	showType?: boolean
}> = ({ entry, isSelected, showType }) => {
	const fileName = getFileName(entry.path)
	const typeLabel = entry.ruleType ? ` [${entry.ruleType}]` : ""

	return (
		<Box>
			<Text color={isSelected ? "cyan" : undefined}>
				{isSelected ? "❯ " : "  "}
				<Text color={entry.enabled ? "green" : "red"}>{entry.enabled ? "●" : "○"}</Text>
				<Text> </Text>
				<Text color="white">{fileName}</Text>
				{showType && <Text color="gray">{typeLabel}</Text>}
			</Text>
		</Box>
	)
}

export const HookRow: React.FC<{
	hook: HookInfo
	isSelected: boolean
}> = ({ hook, isSelected }) => {
	return (
		<Box>
			<Text color={isSelected ? "cyan" : undefined}>
				{isSelected ? "❯ " : "  "}
				<Text color={hook.enabled ? "green" : "red"}>{hook.enabled ? "●" : "○"}</Text>
				<Text> </Text>
				<Text color="white">{hook.name}</Text>
			</Text>
		</Box>
	)
}

export const SkillRow: React.FC<{
	skill: SkillInfo
	isSelected: boolean
}> = ({ skill, isSelected }) => {
	return (
		<Box flexDirection="column">
			<Box>
				<Text color={isSelected ? "cyan" : undefined}>
					{isSelected ? "❯ " : "  "}
					<Text color={skill.enabled ? "green" : "red"}>{skill.enabled ? "●" : "○"}</Text>
					<Text> </Text>
					<Text bold color="white">
						{skill.name}
					</Text>
				</Text>
			</Box>
			{skill.description && (
				<Box marginLeft={4}>
					<Text color="gray">
						{skill.description.length > 60 ? skill.description.slice(0, 57) + "..." : skill.description}
					</Text>
				</Box>
			)}
		</Box>
	)
}

export const TabBar: React.FC<{
	currentTab: TabView
	tabs: typeof TABS
	hooksEnabled?: boolean
	skillsEnabled?: boolean
}> = ({ currentTab, tabs, hooksEnabled, skillsEnabled }) => {
	const visibleTabs = tabs.filter((tab) => {
		if (tab.requiresFlag === "hooks") {
			return hooksEnabled
		}
		if (tab.requiresFlag === "skills") {
			return skillsEnabled
		}
		return true
	})

	return (
		<Box marginBottom={1}>
			{visibleTabs.map((tab, idx) => (
				<React.Fragment key={tab.key}>
					{idx > 0 && <Text color="gray"> │ </Text>}
					<Text bold={currentTab === tab.key} color={currentTab === tab.key ? "cyan" : "gray"}>
						{currentTab === tab.key ? `[${tab.label}]` : tab.label}
					</Text>
				</React.Fragment>
			))}
		</Box>
	)
}

export const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
	<Box marginTop={1}>
		<Text bold color="yellow">
			{title}
		</Text>
	</Box>
)
