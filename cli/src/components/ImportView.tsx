/**
 * Import view component
 * Handles importing API keys from competing CLI agents (Codex, OpenCode)
 */

import { Box, Text, useInput } from "ink"
import React, { useCallback, useEffect, useState } from "react"
import { StateManager } from "@/core/storage/StateManager"
import type { ApiProvider } from "@/shared/api"
import { getProviderModelIdKey } from "@/shared/storage"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import {
	getProviderDisplayName,
	getSourceDisplayName,
	type ImportedKey,
	type ImportSource,
	importFromCodex,
	importFromOpenCode,
} from "../utils/import-configs"

type ImportStep = "select" | "confirm" | "saving" | "error"

interface ImportViewProps {
	source: ImportSource
	onComplete: () => void
	onCancel: () => void
}

export const ImportView: React.FC<ImportViewProps> = ({ source, onComplete, onCancel }) => {
	const { isRawModeSupported } = useStdinContext()
	const [step, setStep] = useState<ImportStep>("select")
	const [keys, setKeys] = useState<ImportedKey[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [confirmIndex, setConfirmIndex] = useState(0)
	const [errorMessage, setErrorMessage] = useState("")

	// Load keys on mount
	useEffect(() => {
		const result = source === "codex" ? importFromCodex() : importFromOpenCode()
		if (result && result.keys.length > 0) {
			setKeys(result.keys)
			if (result.keys.length === 1) {
				// Only one key, go straight to confirm
				setStep("confirm")
			}
		} else {
			setErrorMessage(`Could not read API keys from ${getSourceDisplayName(source)} config`)
			setStep("error")
		}
	}, [source])

	const handleConfirm = useCallback(async () => {
		try {
			setStep("saving")

			const selectedKey = keys[selectedIndex]
			if (!selectedKey) {
				setErrorMessage("No key selected")
				setStep("error")
				return
			}

			const stateManager = StateManager.get()
			const config: Record<string, string> = {
				actModeApiProvider: selectedKey.provider,
				planModeApiProvider: selectedKey.provider,
				apiProvider: selectedKey.provider,
			}

			// Set API key
			config[selectedKey.keyField] = selectedKey.key

			// Set model ID if available (use provider-specific keys)
			if (selectedKey.modelId) {
				const actModelKey = getProviderModelIdKey(selectedKey.provider as ApiProvider, "act")
				const planModelKey = getProviderModelIdKey(selectedKey.provider as ApiProvider, "plan")
				if (actModelKey) config[actModelKey] = selectedKey.modelId
				if (planModelKey) config[planModelKey] = selectedKey.modelId
			}

			stateManager.setApiConfiguration(config)
			stateManager.setGlobalState("welcomeViewCompleted", true)
			await stateManager.flushPendingState()

			onComplete()
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : String(error))
			setStep("error")
		}
	}, [keys, selectedIndex, onComplete])

	useInput(
		(input, key) => {
			if (key.escape) {
				if (step === "confirm" && keys.length > 1) {
					setStep("select")
					setConfirmIndex(0)
				} else if (step === "error") {
					onCancel()
				} else {
					onCancel()
				}
				return
			}

			if (step === "select") {
				if (key.upArrow) {
					setSelectedIndex((prev) => (prev > 0 ? prev - 1 : keys.length - 1))
				} else if (key.downArrow) {
					setSelectedIndex((prev) => (prev < keys.length - 1 ? prev + 1 : 0))
				} else if (key.return) {
					setStep("confirm")
				}
			} else if (step === "confirm") {
				if (key.upArrow || key.downArrow) {
					setConfirmIndex((prev) => (prev === 0 ? 1 : 0))
				} else if (key.return) {
					if (confirmIndex === 0) {
						handleConfirm()
					} else {
						onCancel()
					}
				}
			} else if (step === "error") {
				if (key.return) {
					onCancel()
				}
			}
		},
		{ isActive: isRawModeSupported && step !== "saving" },
	)

	const sourceName = getSourceDisplayName(source)

	if (step === "select") {
		return (
			<Box flexDirection="column">
				<Text color="white">Select which key to import from {sourceName}</Text>
				<Text> </Text>
				{keys.map((k, i) => (
					<Box key={`${k.provider}-${i}`}>
						<Text color={i === selectedIndex ? COLORS.primaryBlue : undefined}>
							{i === selectedIndex ? "❯ " : "  "}
							{getProviderDisplayName(k.provider)}
						</Text>
					</Box>
				))}
				<Text> </Text>
				<Text color="gray">Arrows to navigate, Enter to select, Esc to go back</Text>
			</Box>
		)
	}

	if (step === "confirm") {
		const selectedKey = keys[selectedIndex]
		const providerName = selectedKey ? getProviderDisplayName(selectedKey.provider) : ""
		const maskedKey = selectedKey ? `${selectedKey.key.slice(0, 8)}...${selectedKey.key.slice(-4)}` : ""

		return (
			<Box flexDirection="column">
				<Text color="white">Import API key from {sourceName}?</Text>
				<Text> </Text>
				<Box>
					<Text color="gray">Provider: </Text>
					<Text color="white">{providerName}</Text>
				</Box>
				<Box>
					<Text color="gray">API Key: </Text>
					<Text color="white">{maskedKey}</Text>
				</Box>
				{selectedKey?.modelId && (
					<Box>
						<Text color="gray">Model: </Text>
						<Text color="white">{selectedKey.modelId}</Text>
					</Box>
				)}
				<Text> </Text>
				<Box>
					<Text color={confirmIndex === 0 ? COLORS.primaryBlue : undefined}>
						{confirmIndex === 0 ? "❯ " : "  "}
						Confirm import
					</Text>
				</Box>
				<Box>
					<Text color={confirmIndex === 1 ? COLORS.primaryBlue : undefined}>
						{confirmIndex === 1 ? "❯ " : "  "}
						Cancel
					</Text>
				</Box>
				<Text> </Text>
				<Text color="gray">Enter to confirm, Esc to go back</Text>
			</Box>
		)
	}

	if (step === "saving") {
		return (
			<Box>
				<Text color="white">Importing configuration...</Text>
			</Box>
		)
	}

	if (step === "error") {
		return (
			<Box flexDirection="column">
				<Text bold color="red">
					Something went wrong
				</Text>
				<Text> </Text>
				<Text color="yellow">{errorMessage}</Text>
				<Text> </Text>
				<Text color="gray">Press Enter or Esc to go back</Text>
			</Box>
		)
	}

	return null
}
