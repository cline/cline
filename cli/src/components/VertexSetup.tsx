import VertexData from "@shared/providers/vertex.json"
import { Box, Text, useInput } from "ink"
import React, { useCallback, useMemo, useState } from "react"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { useScrollableList } from "../hooks/useScrollableList"
import { isMouseEscapeSequence } from "../utils/input"

type VertexStep = "project_id" | "region"

export interface VertexConfig {
	vertexProjectId: string
	vertexRegion: string
}

interface VertexSetupProps {
	isActive: boolean
	onComplete: (config: VertexConfig) => void
	onCancel: () => void
}

const VERTEX_REGIONS = VertexData.regions
const REGION_ROWS = 8

/**
 * Inline text input for the project ID field
 */
const ProjectIdInput: React.FC<{
	label: string
	value: string
	onChange: (value: string) => void
	onSubmit: () => void
	onCancel: () => void
	isActive: boolean
	placeholder?: string
	hint?: string
}> = ({ label, value, onChange, onSubmit, onCancel, isActive, placeholder, hint }) => {
	const { isRawModeSupported } = useStdinContext()

	useInput(
		(input, key) => {
			if (isMouseEscapeSequence(input)) return
			if (key.escape) {
				onCancel()
			} else if (key.return) {
				onSubmit()
			} else if (key.backspace || key.delete) {
				onChange(value.slice(0, -1))
			} else if (input && !key.ctrl && !key.meta) {
				onChange(value + input)
			}
		},
		{ isActive: isActive && isRawModeSupported },
	)

	const description = hint || (placeholder ? `e.g. ${placeholder}` : undefined)

	return (
		<Box flexDirection="column">
			<Text color="white">{label}</Text>
			{description && <Text color="gray">{description}</Text>}
			<Text> </Text>
			<Box>
				<Text color="white">{value}</Text>
				<Text inverse> </Text>
			</Box>
			<Text> </Text>
			<Text color="gray">Enter to continue, Esc to go back</Text>
		</Box>
	)
}

export const VertexSetup: React.FC<VertexSetupProps> = ({ isActive, onComplete, onCancel }) => {
	const { isRawModeSupported } = useStdinContext()

	const [step, setStep] = useState<VertexStep>("project_id")
	const [projectId, setProjectId] = useState("")
	const [regionSearch, setRegionSearch] = useState("")
	const [regionIndex, setRegionIndex] = useState(0)

	const filteredRegions = useMemo(() => {
		const search = regionSearch.toLowerCase().trim()
		if (!search) {
			return VERTEX_REGIONS
		}
		return VERTEX_REGIONS.filter((r) => r.toLowerCase().includes(search))
	}, [regionSearch])

	const {
		visibleStart: regionVisibleStart,
		visibleCount: regionVisibleCount,
		showTopIndicator: showRegionTop,
		showBottomIndicator: showRegionBottom,
	} = useScrollableList(filteredRegions.length, regionIndex, REGION_ROWS)

	const visibleRegions = useMemo(
		() => filteredRegions.slice(regionVisibleStart, regionVisibleStart + regionVisibleCount),
		[filteredRegions, regionVisibleStart, regionVisibleCount],
	)

	const goBack = useCallback(() => {
		switch (step) {
			case "project_id":
				onCancel()
				break
			case "region":
				setStep("project_id")
				break
		}
	}, [step, onCancel])

	const getSelectedRegion = useCallback(() => {
		if (filteredRegions.length > 0 && regionIndex >= 0 && regionIndex < filteredRegions.length) {
			return filteredRegions[regionIndex]
		}
		return regionSearch.trim() || "us-east5"
	}, [filteredRegions, regionIndex, regionSearch])

	const finish = useCallback(() => {
		const config: VertexConfig = {
			vertexProjectId: projectId.trim(),
			vertexRegion: getSelectedRegion(),
		}
		onComplete(config)
	}, [projectId, getSelectedRegion, onComplete])


	useInput(
		(input, key) => {
			if (isMouseEscapeSequence(input)) return

			if (step === "region") {
				if (key.escape) {
					goBack()
				} else if (key.upArrow && filteredRegions.length > 0) {
					setRegionIndex((prev) => (prev > 0 ? prev - 1 : filteredRegions.length - 1))
				} else if (key.downArrow && filteredRegions.length > 0) {
					setRegionIndex((prev) => (prev < filteredRegions.length - 1 ? prev + 1 : 0))
				} else if (key.return && (filteredRegions.length > 0 || regionSearch.trim())) {
					finish()
				} else if (key.backspace || key.delete) {
					setRegionSearch((prev) => prev.slice(0, -1))
					setRegionIndex(0)
				} else if (input && !key.ctrl && !key.meta) {
					setRegionSearch((prev) => prev + input)
					setRegionIndex(0)
				}
			}
		},
		{ isActive: isActive && isRawModeSupported && step === "region" },
	)

	if (step === "project_id") {
		return (
			<ProjectIdInput
				hint="Your Google Cloud project ID (e.g. my-gcp-project)"
				isActive={isActive}
				label="Google Cloud Project ID"
				onCancel={goBack}
				onChange={setProjectId}
				onSubmit={() => {
					if (projectId.trim()) setStep("region")
				}}
				placeholder="my-gcp-project"
				value={projectId}
			/>
		)
	}


	if (step === "region") {
		return (
			<Box flexDirection="column">
				<Text color="white">Google Cloud Region</Text>
				<Text> </Text>
				<Box>
					<Text color="gray">Search or enter custom region: </Text>
					<Text color="white">{regionSearch}</Text>
					<Text inverse> </Text>
				</Box>
				<Text> </Text>
				{showRegionTop && <Text color="gray">... {regionVisibleStart} more above</Text>}
				{visibleRegions.map((region, i) => {
					const actualIndex = regionVisibleStart + i
					return (
						<Box key={region}>
							<Text color={actualIndex === regionIndex ? COLORS.primaryBlue : undefined}>
								{actualIndex === regionIndex ? "❯ " : "  "}
								{region}
							</Text>
						</Box>
					)
				})}
				{showRegionBottom && (
					<Text color="gray">
						... {filteredRegions.length - regionVisibleStart - regionVisibleCount} more below
					</Text>
				)}
				<Text> </Text>
				<Text color="gray">Type to search, arrows to navigate, Enter to select, Esc to go back</Text>
			</Box>
		)
	}

	return null
}

