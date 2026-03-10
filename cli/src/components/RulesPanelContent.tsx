/**
 * Rules panel content for inline display in ChatView
 * Shows all rule types (Cline, Cursor, Windsurf, Agents) with toggle functionality
 */

import { RuleScope } from "@shared/proto/cline/file"
import { Box, Text, useInput } from "ink"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import type { Controller } from "@/core/controller"
import { refreshRules } from "@/core/controller/file/refreshRules"
import { toggleClineRule } from "@/core/controller/file/toggleClineRule"
import { useStdinContext } from "../context/StdinContext"
import { isMouseEscapeSequence } from "../utils/input"
import { Panel } from "./Panel"

interface RuleEntry {
	name: string
	path: string
	enabled: boolean
	isGlobal: boolean
	ruleType: "cline" | "cursor" | "windsurf" | "agents"
}

interface RulesPanelContentProps {
	controller: Controller
	onClose: () => void
}

const MAX_VISIBLE = 10

function buildRuleEntries(toggles: Record<string, boolean>, isGlobal: boolean, ruleType: RuleEntry["ruleType"]): RuleEntry[] {
	return Object.entries(toggles).map(([path, enabled]) => ({
		name: path.split("/").pop() || path,
		path,
		enabled,
		isGlobal,
		ruleType,
	}))
}

export const RulesPanelContent: React.FC<RulesPanelContentProps> = ({ controller, onClose }) => {
	const { isRawModeSupported } = useStdinContext()
	const [globalClineToggles, setGlobalClineToggles] = useState<Record<string, boolean>>({})
	const [localClineToggles, setLocalClineToggles] = useState<Record<string, boolean>>({})
	const [localCursorToggles, setLocalCursorToggles] = useState<Record<string, boolean>>({})
	const [localWindsurfToggles, setLocalWindsurfToggles] = useState<Record<string, boolean>>({})
	const [localAgentsToggles, setLocalAgentsToggles] = useState<Record<string, boolean>>({})
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [isLoading, setIsLoading] = useState(true)
	const [loadError, setLoadError] = useState<string | null>(null)

	// Load rules on mount
	useEffect(() => {
		const load = async () => {
			try {
				const data = await refreshRules(controller, {})
				setGlobalClineToggles(data.globalClineRulesToggles?.toggles || {})
				setLocalClineToggles(data.localClineRulesToggles?.toggles || {})
				setLocalCursorToggles(data.localCursorRulesToggles?.toggles || {})
				setLocalWindsurfToggles(data.localWindsurfRulesToggles?.toggles || {})
				setLocalAgentsToggles(data.localAgentsRulesToggles?.toggles || {})
			} catch (error) {
				setLoadError(error instanceof Error ? error.message : String(error))
			} finally {
				setIsLoading(false)
			}
		}
		load()
	}, [controller])

	// Build flat list grouped by: global cline, local cline, cursor, windsurf, agents
	const entries = useMemo(() => {
		const all: RuleEntry[] = [
			...buildRuleEntries(globalClineToggles, true, "cline"),
			...buildRuleEntries(localClineToggles, false, "cline"),
			...buildRuleEntries(localCursorToggles, false, "cursor"),
			...buildRuleEntries(localWindsurfToggles, false, "windsurf"),
			...buildRuleEntries(localAgentsToggles, false, "agents"),
		]
		return all
	}, [globalClineToggles, localClineToggles, localCursorToggles, localWindsurfToggles, localAgentsToggles])

	// Handle toggle
	const handleToggle = useCallback(async () => {
		const entry = entries[selectedIndex]
		if (!entry) return

		const newEnabled = !entry.enabled

		// Optimistic update
		const setToggle = (setter: React.Dispatch<React.SetStateAction<Record<string, boolean>>>) => {
			setter((prev) => ({ ...prev, [entry.path]: newEnabled }))
		}

		if (entry.ruleType === "cline") {
			if (entry.isGlobal) {
				setToggle(setGlobalClineToggles)
			} else {
				setToggle(setLocalClineToggles)
			}
			try {
				const scope = entry.isGlobal ? RuleScope.GLOBAL : RuleScope.LOCAL
				const result = await toggleClineRule(controller, {
					metadata: undefined,
					rulePath: entry.path,
					enabled: newEnabled,
					scope,
				})
				if (result.globalClineRulesToggles?.toggles) {
					setGlobalClineToggles(result.globalClineRulesToggles.toggles)
				}
				if (result.localClineRulesToggles?.toggles) {
					setLocalClineToggles(result.localClineRulesToggles.toggles)
				}
			} catch {
				// Revert
				if (entry.isGlobal) {
					setToggle(setGlobalClineToggles)
				} else {
					setToggle(setLocalClineToggles)
				}
			}
		} else if (entry.ruleType === "cursor") {
			setToggle(setLocalCursorToggles)
			const toggles = controller.stateManager.getWorkspaceStateKey("localCursorRulesToggles") || {}
			toggles[entry.path] = newEnabled
			controller.stateManager.setWorkspaceState("localCursorRulesToggles", toggles)
		} else if (entry.ruleType === "windsurf") {
			setToggle(setLocalWindsurfToggles)
			const toggles = controller.stateManager.getWorkspaceStateKey("localWindsurfRulesToggles") || {}
			toggles[entry.path] = newEnabled
			controller.stateManager.setWorkspaceState("localWindsurfRulesToggles", toggles)
		} else if (entry.ruleType === "agents") {
			setToggle(setLocalAgentsToggles)
			const toggles = controller.stateManager.getWorkspaceStateKey("localAgentsRulesToggles") || {}
			toggles[entry.path] = newEnabled
			controller.stateManager.setWorkspaceState("localAgentsRulesToggles", toggles)
		}
	}, [controller, entries, selectedIndex])

	useInput(
		(input, key) => {
			if (isMouseEscapeSequence(input)) return
			if (key.escape) {
				onClose()
				return
			}

			// Navigation
			if (key.upArrow || input === "k") {
				setSelectedIndex((i) => (i > 0 ? i - 1 : entries.length - 1))
				return
			}
			if (key.downArrow || input === "j") {
				setSelectedIndex((i) => (i < entries.length - 1 ? i + 1 : 0))
				return
			}

			// Toggle
			if (input === " " || key.return) {
				handleToggle()
				return
			}
		},
		{ isActive: isRawModeSupported },
	)

	// Scrolling window
	const halfVisible = Math.floor(MAX_VISIBLE / 2)
	const startIndex = Math.max(0, Math.min(selectedIndex - halfVisible, entries.length - MAX_VISIBLE))

	if (isLoading) {
		return (
			<Panel label="Rules">
				<Text color="gray">Loading rules...</Text>
			</Panel>
		)
	}

	if (entries.length === 0) {
		return (
			<Panel label="Rules">
				<Box flexDirection="column" gap={1}>
					{loadError ? (
						<Text color="red">Error loading rules: {loadError}</Text>
					) : (
						<React.Fragment>
							<Text color="gray">No rules found.</Text>
							<Text>
								Create a <Text color="white">.clinerules</Text> file or directory in your project root to add
								rules.
							</Text>
						</React.Fragment>
					)}
				</Box>
			</Panel>
		)
	}

	// Determine section headers
	const getSectionLabel = (entry: RuleEntry): string => {
		if (entry.ruleType === "cline" && entry.isGlobal) return "Global Cline Rules"
		if (entry.ruleType === "cline" && !entry.isGlobal) return "Workspace Cline Rules"
		if (entry.ruleType === "cursor") return "Cursor Rules"
		if (entry.ruleType === "windsurf") return "Windsurf Rules"
		if (entry.ruleType === "agents") return "Agents Rules"
		return ""
	}

	return (
		<Panel label="Rules">
			<Box flexDirection="column">
				{entries.slice(startIndex, startIndex + MAX_VISIBLE).map((entry, idx) => {
					const actualIndex = startIndex + idx
					const prevEntry = entries[actualIndex - 1]
					const showHeader = actualIndex === 0 || (prevEntry && getSectionLabel(prevEntry) !== getSectionLabel(entry))

					return (
						<React.Fragment key={`${entry.ruleType}-${entry.path}`}>
							{showHeader && (
								<Box marginTop={actualIndex > 0 ? 1 : 0}>
									<Text bold color="gray">
										{getSectionLabel(entry)}:
									</Text>
								</Box>
							)}
							<RuleRow entry={entry} isSelected={actualIndex === selectedIndex} />
						</React.Fragment>
					)
				})}

				{/* Help text */}
				<Box marginTop={1}>
					<Text color="gray">↑/↓ Navigate • Space/Enter Toggle • Esc Close</Text>
				</Box>
			</Box>
		</Panel>
	)
}

const RuleRow: React.FC<{ entry: RuleEntry; isSelected: boolean }> = ({ entry, isSelected }) => {
	return (
		<Box>
			<Text color={isSelected ? "cyan" : undefined}>
				{isSelected ? "❯ " : "  "}
				<Text color={entry.enabled ? "green" : "red"}>{entry.enabled ? "●" : "○"}</Text>
				<Text> </Text>
				<Text bold={isSelected} color="white">
					{entry.name}
				</Text>
			</Text>
		</Box>
	)
}
