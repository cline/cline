/**
 * Rules panel content for inline display in ChatView
 * Shows all rule types (Cline, Cursor, Windsurf, Agents) with toggle functionality
 */

import { RuleScope } from "@shared/proto/cline/file"
import { Box, Text, useInput } from "ink"
import React, { useCallback, useEffect, useState } from "react"
import type { Controller } from "@/core/controller"
import { refreshRules } from "@/core/controller/file/refreshRules"
import { toggleAgentsRule } from "@/core/controller/file/toggleAgentsRule"
import { toggleClineRule } from "@/core/controller/file/toggleClineRule"
import { toggleCursorRule } from "@/core/controller/file/toggleCursorRule"
import { toggleWindsurfRule } from "@/core/controller/file/toggleWindsurfRule"
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
const PATH_SEPARATOR_REGEX = /[\\/]/

function buildRuleEntries(toggles: Record<string, boolean>, isGlobal: boolean, ruleType: RuleEntry["ruleType"]): RuleEntry[] {
	return Object.entries(toggles).map(([path, enabled]) => ({
		name: path.split(PATH_SEPARATOR_REGEX).at(-1) || path,
		path,
		enabled,
		isGlobal,
		ruleType,
	}))
}

function normalizeRefreshedRules(data: Awaited<ReturnType<typeof refreshRules>>): RuleEntry[] {
	return [
		...buildRuleEntries(data.globalClineRulesToggles?.toggles ?? {}, true, "cline"),
		...buildRuleEntries(data.localClineRulesToggles?.toggles ?? {}, false, "cline"),
		...buildRuleEntries(data.localCursorRulesToggles?.toggles ?? {}, false, "cursor"),
		...buildRuleEntries(data.localWindsurfRulesToggles?.toggles ?? {}, false, "windsurf"),
		...buildRuleEntries(data.localAgentsRulesToggles?.toggles ?? {}, false, "agents"),
	]
}

export const RulesPanelContent: React.FC<RulesPanelContentProps> = ({ controller, onClose }) => {
	const { isRawModeSupported } = useStdinContext()
	const [entries, setEntries] = useState<RuleEntry[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [isLoading, setIsLoading] = useState(true)
	const [isToggling, setIsToggling] = useState(false)
	const [loadError, setLoadError] = useState<string | null>(null)

	const loadRules = useCallback(async () => {
		try {
			const data = await refreshRules(controller, {})
			setEntries(normalizeRefreshedRules(data))
			setLoadError(null)
		} catch (error) {
			setLoadError(error instanceof Error ? error.message : String(error))
		}
	}, [controller])

	// Load rules on mount
	useEffect(() => {
		const load = async () => {
			await loadRules()
			setIsLoading(false)
		}
		load()
	}, [loadRules])

	// Subscribe to external state changes so that toggles made in VSCode are
	// reflected here immediately without requiring any user action.
	useEffect(() => {
		return controller.subscribeToExternalStateChange(() => {
			loadRules()
		})
	}, [controller, loadRules])

	// Handle toggle — calls the appropriate backend function then re-fetches
	const handleToggle = useCallback(async () => {
		const entry = entries[selectedIndex]
		if (!entry || isToggling) return

		setIsToggling(true)
		try {
			const newEnabled = !entry.enabled

			switch (entry.ruleType) {
				case "cline": {
					const scope = entry.isGlobal ? RuleScope.GLOBAL : RuleScope.LOCAL
					await toggleClineRule(controller, {
						metadata: undefined,
						rulePath: entry.path,
						enabled: newEnabled,
						scope,
					})
					break
				}
				case "cursor":
					await toggleCursorRule(controller, { metadata: undefined, rulePath: entry.path, enabled: newEnabled })
					break
				case "windsurf":
					await toggleWindsurfRule(controller, { metadata: undefined, rulePath: entry.path, enabled: newEnabled })
					break
				case "agents":
					await toggleAgentsRule(controller, { metadata: undefined, rulePath: entry.path, enabled: newEnabled })
					break
			}

			await loadRules()
		} finally {
			setIsToggling(false)
		}
	}, [controller, entries, selectedIndex, isToggling, loadRules])

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
							<RuleRow
								entry={entry}
								isSelected={actualIndex === selectedIndex}
								isToggling={actualIndex === selectedIndex && isToggling}
							/>
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

const RuleRow: React.FC<{ entry: RuleEntry; isSelected: boolean; isToggling: boolean }> = ({ entry, isSelected, isToggling }) => {
	return (
		<Box>
			<Text color={isSelected ? "cyan" : undefined}>
				{isSelected ? "❯ " : "  "}
				{isToggling ? (
					<Text color="yellow">◌</Text>
				) : (
					<Text color={entry.enabled ? "green" : "red"}>{entry.enabled ? "●" : "○"}</Text>
				)}
				<Text> </Text>
				<Text bold={isSelected} color="white">
					{entry.name}
				</Text>
			</Text>
		</Box>
	)
}
