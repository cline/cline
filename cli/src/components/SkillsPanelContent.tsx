/**
 * Skills panel content for inline display in ChatView
 * Shows installed skills with toggle and use functionality
 */

import { exec } from "node:child_process"
import os from "node:os"
import { Box, Text, useInput } from "ink"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import type { Controller } from "@/core/controller"
import { refreshSkills } from "@/core/controller/file/refreshSkills"
import { toggleSkill } from "@/core/controller/file/toggleSkill"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { isMouseEscapeSequence } from "../utils/input"
import { Panel } from "./Panel"

const SKILLS_MARKETPLACE_URL = "https://skills.sh/"

interface SkillInfo {
	name: string
	description: string
	path: string
	enabled: boolean
}

interface SkillsPanelContentProps {
	controller: Controller
	onClose: () => void
	onUseSkill: (skillPath: string) => void
}

const MAX_VISIBLE = 8

export const SkillsPanelContent: React.FC<SkillsPanelContentProps> = ({ controller, onClose, onUseSkill }) => {
	const { isRawModeSupported } = useStdinContext()
	const [globalSkills, setGlobalSkills] = useState<SkillInfo[]>([])
	const [localSkills, setLocalSkills] = useState<SkillInfo[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [isLoading, setIsLoading] = useState(true)

	// Load skills on mount
	useEffect(() => {
		const loadSkills = async () => {
			try {
				const skillsData = await refreshSkills(controller)
				setGlobalSkills(skillsData.globalSkills || [])
				setLocalSkills(skillsData.localSkills || [])
			} catch (_error) {
				// Skills loading failed, show empty state
			} finally {
				setIsLoading(false)
			}
		}
		loadSkills()
	}, [controller])

	// Build flat list of skills with source info (global first, then local, alphabetical within each)
	const skillEntries = useMemo(() => {
		const entries: { skill: SkillInfo; isGlobal: boolean }[] = []
		globalSkills.forEach((skill) => entries.push({ skill, isGlobal: true }))
		localSkills.forEach((skill) => entries.push({ skill, isGlobal: false }))
		return entries.sort((a, b) => {
			if (a.isGlobal !== b.isGlobal) return a.isGlobal ? -1 : 1
			return a.skill.name.localeCompare(b.skill.name)
		})
	}, [globalSkills, localSkills])

	// Handle toggle
	const handleToggle = useCallback(async () => {
		const entry = skillEntries[selectedIndex]
		if (!entry) return

		const newEnabled = !entry.skill.enabled
		const setter = entry.isGlobal ? setGlobalSkills : setLocalSkills
		const update = (enabled: boolean) =>
			setter((prev) => prev.map((s) => (s.path === entry.skill.path ? { ...s, enabled } : s)))

		// Optimistic update
		update(newEnabled)

		try {
			await toggleSkill(controller, {
				metadata: undefined,
				skillPath: entry.skill.path,
				isGlobal: entry.isGlobal,
				enabled: newEnabled,
			})
		} catch {
			// Revert on failure
			update(!newEnabled)
		}
	}, [controller, skillEntries, selectedIndex])

	// Handle use skill (insert @ mention)
	const handleUse = useCallback(() => {
		const entry = skillEntries[selectedIndex]
		if (!entry) return
		onUseSkill(entry.skill.path)
	}, [skillEntries, selectedIndex, onUseSkill])

	// Handle opening the marketplace URL
	const openMarketplace = useCallback(() => {
		const platform = os.platform()
		let command: string
		if (platform === "darwin") {
			command = `open "${SKILLS_MARKETPLACE_URL}"`
		} else if (platform === "win32") {
			command = `start "${SKILLS_MARKETPLACE_URL}"`
		} else {
			command = `xdg-open "${SKILLS_MARKETPLACE_URL}"`
		}
		exec(command, (err) => {
			if (err) {
				// Fallback: show URL in terminal if browser open fails
				console.error(`Visit: ${SKILLS_MARKETPLACE_URL}`)
			}
		})
	}, [])

	// Total items = skills + 1 for marketplace link
	const totalItems = skillEntries.length + 1
	const isMarketplaceSelected = selectedIndex === skillEntries.length

	useInput(
		(input, key) => {
			if (isMouseEscapeSequence(input)) {
				return
			}
			if (key.escape) {
				onClose()
				return
			}

			// Navigation
			if (key.upArrow || input === "k") {
				setSelectedIndex((i) => (i > 0 ? i - 1 : totalItems - 1))
				return
			}
			if (key.downArrow || input === "j") {
				setSelectedIndex((i) => (i < totalItems - 1 ? i + 1 : 0))
				return
			}

			// Actions
			if (key.return) {
				if (isMarketplaceSelected) {
					openMarketplace()
				} else {
					handleUse()
				}
				return
			}
			if (input === " " && !isMarketplaceSelected) {
				handleToggle()
				return
			}
		},
		{ isActive: isRawModeSupported },
	)

	// Scrolling window (includes marketplace row)
	const halfVisible = Math.floor(MAX_VISIBLE / 2)
	const startIndex = Math.max(0, Math.min(selectedIndex - halfVisible, totalItems - MAX_VISIBLE))

	if (isLoading) {
		return (
			<Panel label="Skills">
				<Text color="gray">Loading skills...</Text>
			</Panel>
		)
	}

	// Check if marketplace row is in visible window
	const marketplaceIndex = skillEntries.length
	const showMarketplace = marketplaceIndex >= startIndex && marketplaceIndex < startIndex + MAX_VISIBLE

	return (
		<Panel label="Skills">
			<Box flexDirection="column" gap={1}>
				{skillEntries.length === 0 ? (
					<Box flexDirection="column" gap={1}>
						<Text color="gray">No skills installed.</Text>
						<Text>
							Install skills with: <Text color="white">npx skills add owner/repo</Text>
						</Text>
					</Box>
				) : (
					<Box flexDirection="column">
						{skillEntries
							.slice(startIndex, Math.min(startIndex + MAX_VISIBLE, skillEntries.length))
							.map((entry, idx) => {
								const actualIndex = startIndex + idx
								const prevEntry = skillEntries[actualIndex - 1]
								const showHeader = actualIndex === 0 || (prevEntry && prevEntry.isGlobal !== entry.isGlobal)

								return (
									<React.Fragment key={entry.skill.path}>
										{showHeader && (
											<Box marginTop={actualIndex > 0 ? 1 : 0}>
												<Text bold color="gray">
													{entry.isGlobal ? "Global Skills:" : "Workspace Skills:"}
												</Text>
											</Box>
										)}
										<SkillRow isSelected={actualIndex === selectedIndex} skill={entry.skill} />
									</React.Fragment>
								)
							})}
					</Box>
				)}

				{/* Marketplace link - selectable */}
				{showMarketplace && (
					<Box marginTop={1}>
						<Text color={isMarketplaceSelected ? "cyan" : undefined}>
							{isMarketplaceSelected ? "❯ " : "  "}
							<Text color={COLORS.primaryBlue}>Browse more skills at https://skills.sh/</Text>
						</Text>
					</Box>
				)}

				{/* Help text */}
				<Box marginTop={1}>
					<Text color="gray">
						↑/↓ Navigate • Enter {isMarketplaceSelected ? "Open" : "Use"}
						{!isMarketplaceSelected && " • Space Toggle"}
					</Text>
				</Box>
			</Box>
		</Panel>
	)
}

const SkillRow: React.FC<{ skill: SkillInfo; isSelected: boolean }> = ({ skill, isSelected }) => {
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
