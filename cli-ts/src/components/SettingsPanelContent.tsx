/**
 * Settings panel content for inline display in ChatView
 * Uses a tabbed interface: API, Auto Approve, Features, Other
 */

import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import { Box, Text, useInput } from "ink"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { StateManager } from "@/core/storage/StateManager"
import { useStdinContext } from "../context/StdinContext"
import { Checkbox } from "./Checkbox"
import { hasModelPicker, ModelPicker } from "./ModelPicker"
import { Panel, PanelTab } from "./Panel"

interface SettingsPanelContentProps {
	onClose: () => void
}

type SettingsTab = "api" | "auto-approve" | "features" | "other"

interface ListItem {
	key: string
	label: string
	type: "checkbox" | "readonly" | "editable" | "separator" | "header"
	value: string | boolean
	description?: string
	isSubItem?: boolean
	parentKey?: string
}

const TABS: PanelTab[] = [
	{ key: "api", label: "API" },
	{ key: "auto-approve", label: "Auto-approve" },
	{ key: "features", label: "Features" },
	{ key: "other", label: "Other" },
]

// Settings configuration for simple boolean toggles
const FEATURE_SETTINGS = {
	autoCondense: {
		stateKey: "useAutoCondense" as const,
		default: false,
		label: "Auto-condense",
		description: "Automatically summarize long conversations",
	},
	webTools: {
		stateKey: "clineWebToolsEnabled" as const,
		default: true,
		label: "Web tools",
		description: "Enable web search and fetch tools",
	},
	strictPlanMode: {
		stateKey: "strictPlanModeEnabled" as const,
		default: true,
		label: "Strict plan mode",
		description: "Require explicit mode switching",
	},
	nativeToolCall: {
		stateKey: "nativeToolCallEnabled" as const,
		default: true,
		label: "Native tool call",
		description: "Use model's native tool calling API",
	},
	parallelToolCalling: {
		stateKey: "enableParallelToolCalling" as const,
		default: false,
		label: "Parallel tool calling",
		description: "Allow multiple tools in a single response",
	},
	skillsEnabled: {
		stateKey: "skillsEnabled" as const,
		default: false,
		label: "Skills",
		description: "Enable reusable agent instructions",
	},
	autoApproveAll: {
		stateKey: "yoloModeToggled" as const,
		default: false,
		label: "Auto-approve all",
		description: "Automatically approve all actions (Shift+Tab)",
	},
} as const

type FeatureKey = keyof typeof FEATURE_SETTINGS

export const SettingsPanelContent: React.FC<SettingsPanelContentProps> = ({ onClose }) => {
	const { isRawModeSupported } = useStdinContext()
	const stateManager = StateManager.get()

	// UI state
	const [currentTab, setCurrentTab] = useState<SettingsTab>("api")
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [isEditing, setIsEditing] = useState(false)
	const [isPickingModel, setIsPickingModel] = useState(false)
	const [pickingModelKey, setPickingModelKey] = useState<"actModelId" | "planModelId" | null>(null)
	const [editValue, setEditValue] = useState("")

	// Settings state - single object for feature toggles
	const [features, setFeatures] = useState<Record<FeatureKey, boolean>>(() => {
		const initial: Record<string, boolean> = {}
		for (const [key, config] of Object.entries(FEATURE_SETTINGS)) {
			initial[key] = stateManager.getGlobalSettingsKey(config.stateKey) ?? config.default
		}
		return initial as Record<FeatureKey, boolean>
	})

	// API tab state
	const [separateModels, setSeparateModels] = useState<boolean>(
		() => stateManager.getGlobalSettingsKey("planActSeparateModelsSetting") ?? false,
	)
	// Thinking is enabled if budget > 0
	const [actThinkingEnabled, setActThinkingEnabled] = useState<boolean>(
		() => (stateManager.getGlobalSettingsKey("actModeThinkingBudgetTokens") ?? 0) > 0,
	)
	const [planThinkingEnabled, setPlanThinkingEnabled] = useState<boolean>(
		() => (stateManager.getGlobalSettingsKey("planModeThinkingBudgetTokens") ?? 0) > 0,
	)

	// Auto-approve settings (complex nested object)
	const [autoApproveSettings, setAutoApproveSettings] = useState<AutoApprovalSettings>(() => {
		return stateManager.getGlobalSettingsKey("autoApprovalSettings") ?? DEFAULT_AUTO_APPROVAL_SETTINGS
	})

	// Other tab state
	const [preferredLanguage, setPreferredLanguage] = useState<string>(
		() => stateManager.getGlobalSettingsKey("preferredLanguage") || "English",
	)
	const [telemetry, setTelemetry] = useState<TelemetrySetting>(
		() => stateManager.getGlobalSettingsKey("telemetrySetting") || "unset",
	)

	// Get current provider and model info (refresh on each render to catch changes)
	const apiConfig = stateManager.getApiConfiguration()
	const provider = apiConfig.actModeApiProvider || apiConfig.planModeApiProvider || "not configured"
	const actModelId = (stateManager.getGlobalSettingsKey("actModeApiModelId") as string) || ""
	const planModelId = (stateManager.getGlobalSettingsKey("planModeApiModelId") as string) || ""

	// Toggle a feature setting
	const toggleFeature = useCallback(
		(key: FeatureKey) => {
			const config = FEATURE_SETTINGS[key]
			const newValue = !features[key]
			setFeatures((prev) => ({ ...prev, [key]: newValue }))
			stateManager.setGlobalState(config.stateKey, newValue)
		},
		[features, stateManager],
	)

	// Build items list based on current tab
	const items: ListItem[] = useMemo(() => {
		switch (currentTab) {
			case "api":
				return [
					{ key: "provider", label: "Provider", type: "readonly", value: provider },
					{ key: "actHeader", label: separateModels ? "Act Mode" : "Model", type: "header", value: "" },
					{ key: "actModelId", label: "Model ID", type: "editable", value: actModelId || "not set" },
					{ key: "actThinkingEnabled", label: "Enable thinking", type: "checkbox", value: actThinkingEnabled },
					...(separateModels
						? [
								{ key: "planHeader", label: "Plan Mode", type: "header" as const, value: "" },
								{
									key: "planModelId",
									label: "Model ID",
									type: "editable" as const,
									value: planModelId || "not set",
								},
								{
									key: "planThinkingEnabled",
									label: "Enable thinking",
									type: "checkbox" as const,
									value: planThinkingEnabled,
								},
							]
						: []),
					{
						key: "separateModels",
						label: "Use separate models for Plan and Act",
						type: "checkbox",
						value: separateModels,
					},
				]

			case "auto-approve": {
				const result: ListItem[] = []
				const actions = autoApproveSettings.actions

				// Helper to add parent/child checkbox pairs
				const addActionPair = (
					parentKey: string,
					parentLabel: string,
					parentDesc: string,
					childKey: string,
					childLabel: string,
					childDesc: string,
				) => {
					result.push({
						key: parentKey,
						label: parentLabel,
						type: "checkbox",
						value: actions[parentKey as keyof typeof actions],
						description: parentDesc,
					})
					if (actions[parentKey as keyof typeof actions]) {
						result.push({
							key: childKey,
							label: childLabel,
							type: "checkbox",
							value: actions[childKey as keyof typeof actions] ?? false,
							description: childDesc,
							isSubItem: true,
							parentKey,
						})
					}
				}

				addActionPair(
					"readFiles",
					"Read project files",
					"Read files in the working directory",
					"readFilesExternally",
					"Read all files",
					"Read files outside working directory",
				)
				addActionPair(
					"editFiles",
					"Edit project files",
					"Edit files in the working directory",
					"editFilesExternally",
					"Edit all files",
					"Edit files outside working directory",
				)
				addActionPair(
					"executeSafeCommands",
					"Execute safe commands",
					"Run low-risk terminal commands",
					"executeAllCommands",
					"Execute all commands",
					"Run any terminal command",
				)

				result.push(
					{
						key: "useBrowser",
						label: "Use the browser",
						type: "checkbox",
						value: actions.useBrowser,
						description: "Browse and interact with web pages",
					},
					{
						key: "useMcp",
						label: "Use MCP servers",
						type: "checkbox",
						value: actions.useMcp,
						description: "Use Model Context Protocol tools",
					},
					{ key: "separator", label: "", type: "separator", value: false },
					{
						key: "enableNotifications",
						label: "Enable notifications",
						type: "checkbox",
						value: autoApproveSettings.enableNotifications,
						description: "Show notifications for actions",
					},
				)
				return result
			}

			case "features":
				return Object.entries(FEATURE_SETTINGS).map(([key, config]) => ({
					key,
					label: config.label,
					type: "checkbox" as const,
					value: features[key as FeatureKey],
					description: config.description,
				}))

			case "other":
				return [
					{ key: "language", label: "Preferred language", type: "editable", value: preferredLanguage },
					{
						key: "telemetry",
						label: "Error/usage reporting",
						type: "checkbox",
						value: telemetry === "enabled",
						description: "Help improve Cline by sending anonymous usage data",
					},
				]

			default:
				return []
		}
	}, [
		currentTab,
		provider,
		actModelId,
		planModelId,
		separateModels,
		actThinkingEnabled,
		planThinkingEnabled,
		autoApproveSettings,
		features,
		preferredLanguage,
		telemetry,
	])

	// Reset selection when changing tabs
	const handleTabChange = useCallback((tabKey: string) => {
		setCurrentTab(tabKey as SettingsTab)
		setSelectedIndex(0)
		setIsEditing(false)
		setIsPickingModel(false)
		setPickingModelKey(null)
	}, [])

	// Ensure selected index is valid when items change
	useEffect(() => {
		if (selectedIndex >= items.length) {
			setSelectedIndex(Math.max(0, items.length - 1))
		}
	}, [items.length, selectedIndex])

	// Handle toggle/edit for selected item
	const handleAction = useCallback(() => {
		const item = items[selectedIndex]
		if (!item || item.type === "readonly" || item.type === "separator" || item.type === "header") return

		if (item.type === "editable") {
			// For model ID fields, check if we should use the model picker
			if ((item.key === "actModelId" || item.key === "planModelId") && hasModelPicker(provider)) {
				setPickingModelKey(item.key as "actModelId" | "planModelId")
				setIsPickingModel(true)
				return
			}
			setEditValue(typeof item.value === "string" ? item.value : "")
			setIsEditing(true)
			return
		}

		// Checkbox handling
		const newValue = !item.value

		// Feature settings (simple toggles)
		if (item.key in FEATURE_SETTINGS) {
			toggleFeature(item.key as FeatureKey)
			return
		}

		// API tab
		if (item.key === "separateModels") {
			setSeparateModels(newValue)
			stateManager.setGlobalState("planActSeparateModelsSetting", newValue)
			return
		}

		// Thinking toggles - set budget to 1024 when enabled, 0 when disabled
		if (item.key === "actThinkingEnabled") {
			setActThinkingEnabled(newValue)
			stateManager.setGlobalState("actModeThinkingBudgetTokens", newValue ? 1024 : 0)
			return
		}
		if (item.key === "planThinkingEnabled") {
			setPlanThinkingEnabled(newValue)
			stateManager.setGlobalState("planModeThinkingBudgetTokens", newValue ? 1024 : 0)
			return
		}

		// Other tab
		if (item.key === "telemetry") {
			const newTelemetry: TelemetrySetting = newValue ? "enabled" : "disabled"
			setTelemetry(newTelemetry)
			stateManager.setGlobalState("telemetrySetting", newTelemetry)
			return
		}

		// Auto-approve actions
		if (item.key === "enableNotifications") {
			const newSettings = {
				...autoApproveSettings,
				version: (autoApproveSettings.version ?? 1) + 1,
				enableNotifications: newValue,
			}
			setAutoApproveSettings(newSettings)
			stateManager.setGlobalState("autoApprovalSettings", newSettings)
			return
		}

		// Auto-approve action toggles
		const actionKey = item.key as keyof AutoApprovalSettings["actions"]
		const newActions = { ...autoApproveSettings.actions, [actionKey]: newValue }

		// If disabling a parent, also disable its children
		if (!newValue) {
			if (actionKey === "readFiles") newActions.readFilesExternally = false
			if (actionKey === "editFiles") newActions.editFilesExternally = false
			if (actionKey === "executeSafeCommands") newActions.executeAllCommands = false
		}

		// If enabling a child, also enable its parent
		if (newValue && item.parentKey) {
			newActions[item.parentKey as keyof typeof newActions] = true
		}

		const newSettings = { ...autoApproveSettings, version: (autoApproveSettings.version ?? 1) + 1, actions: newActions }
		setAutoApproveSettings(newSettings)
		stateManager.setGlobalState("autoApprovalSettings", newSettings)
	}, [items, selectedIndex, stateManager, autoApproveSettings, toggleFeature])

	// Handle model selection from picker
	const handleModelSelect = useCallback(
		(modelId: string) => {
			if (!pickingModelKey) return
			const stateKey = pickingModelKey === "actModelId" ? "actModeApiModelId" : "planModeApiModelId"
			stateManager.setGlobalState(stateKey, modelId)
			setIsPickingModel(false)
			setPickingModelKey(null)
		},
		[pickingModelKey, stateManager],
	)

	// Handle saving edited value
	const handleSave = useCallback(() => {
		const item = items[selectedIndex]
		if (!item) return

		switch (item.key) {
			case "actModelId":
				stateManager.setGlobalState("actModeApiModelId", editValue || undefined)
				break
			case "planModelId":
				stateManager.setGlobalState("planModeApiModelId", editValue || undefined)
				break
			case "language":
				setPreferredLanguage(editValue)
				stateManager.setGlobalState("preferredLanguage", editValue)
				break
		}
		setIsEditing(false)
	}, [items, selectedIndex, editValue, stateManager])

	// Navigate to next/prev item, skipping separators
	const navigateItems = useCallback(
		(direction: "up" | "down") => {
			setSelectedIndex((i) => {
				let next = direction === "up" ? (i > 0 ? i - 1 : items.length - 1) : i < items.length - 1 ? i + 1 : 0

				// Skip separators and headers
				while ((items[next]?.type === "separator" || items[next]?.type === "header") && next !== i) {
					next = direction === "up" ? (next > 0 ? next - 1 : items.length - 1) : next < items.length - 1 ? next + 1 : 0
				}
				return next
			})
		},
		[items],
	)

	// Navigate tabs
	const navigateTabs = useCallback(
		(direction: "left" | "right") => {
			const tabKeys = TABS.map((t) => t.key)
			const currentIdx = tabKeys.indexOf(currentTab)
			const newIdx =
				direction === "left"
					? currentIdx > 0
						? currentIdx - 1
						: tabKeys.length - 1
					: currentIdx < tabKeys.length - 1
						? currentIdx + 1
						: 0
			handleTabChange(tabKeys[newIdx])
		},
		[currentTab, handleTabChange],
	)

	// Handle keyboard input
	useInput(
		(input, key) => {
			// Model picker mode - escape to close, input is handled by ModelPicker
			if (isPickingModel) {
				if (key.escape) {
					setIsPickingModel(false)
					setPickingModelKey(null)
				}
				return
			}

			if (isEditing) {
				if (key.escape) {
					setIsEditing(false)
					return
				}
				if (key.return) {
					handleSave()
					return
				}
				if (key.backspace || key.delete) {
					setEditValue((prev) => prev.slice(0, -1))
					return
				}
				if (input && !key.ctrl && !key.meta) {
					setEditValue((prev) => prev + input)
				}
				return
			}

			if (key.escape) {
				onClose()
				return
			}
			if (key.leftArrow) {
				navigateTabs("left")
				return
			}
			if (key.rightArrow) {
				navigateTabs("right")
				return
			}
			if (key.upArrow) {
				navigateItems("up")
				return
			}
			if (key.downArrow) {
				navigateItems("down")
				return
			}
			if (key.tab || key.return) {
				handleAction()
				return
			}
		},
		{ isActive: isRawModeSupported },
	)

	// Render content
	const renderContent = () => {
		if (isPickingModel && pickingModelKey) {
			const label = pickingModelKey === "actModelId" ? "Model ID (Act)" : "Model ID (Plan)"
			return (
				<Box flexDirection="column">
					<Text bold color="blueBright">
						Select: {label}
					</Text>
					<Box marginTop={1}>
						<ModelPicker
							isActive={isPickingModel}
							onChange={() => {}}
							onSubmit={handleModelSelect}
							provider={provider}
						/>
					</Box>
					<Box marginTop={1}>
						<Text color="gray" dimColor>
							Type to search, arrows to navigate, Enter to select, Esc to cancel
						</Text>
					</Box>
				</Box>
			)
		}

		if (isEditing) {
			const item = items[selectedIndex]
			return (
				<Box flexDirection="column">
					<Text bold color="blueBright">
						Edit: {item?.label}
					</Text>
					<Box marginTop={1}>
						<Text color="white">{editValue}</Text>
						<Text color="gray">|</Text>
					</Box>
					<Text color="gray" dimColor>
						Enter to save, Esc to cancel
					</Text>
				</Box>
			)
		}

		// Show special message for auto-approve tab when auto-approve all is enabled
		if (currentTab === "auto-approve" && features.autoApproveAll) {
			return (
				<Box flexDirection="column">
					<Text color="green">Auto-approve all is enabled (Shift+Tab)</Text>
					<Box marginTop={1}>
						<Text color="gray" dimColor>
							All tool calls are automatically approved. When disabled, the settings
						</Text>
					</Box>
					<Text color="gray" dimColor>
						below control which actions are auto-approved.
					</Text>
				</Box>
			)
		}

		return (
			<Box flexDirection="column">
				{currentTab === "auto-approve" && !features.autoApproveAll && (
					<Box marginBottom={1}>
						<Text color="gray" dimColor>
							These actions are auto-approved when 'Auto-approve all' is disabled:
						</Text>
					</Box>
				)}
				{items.map((item, idx) => {
					const isSelected = idx === selectedIndex

					if (item.type === "header") {
						return (
							<Box key={item.key} marginTop={idx > 0 ? 0 : 0}>
								<Text bold color="white">
									{item.label}
								</Text>
							</Box>
						)
					}

					if (item.type === "separator") {
						return (
							<Box
								borderBottom={false}
								borderColor="gray"
								borderDimColor
								borderLeft={false}
								borderRight={false}
								borderStyle="single"
								borderTop
								key={item.key}
								width="100%"
							/>
						)
					}

					if (item.type === "checkbox") {
						return (
							<Box key={item.key} marginLeft={item.isSubItem ? 2 : 0}>
								<Checkbox
									checked={Boolean(item.value)}
									description={item.description}
									isSelected={isSelected}
									label={item.label}
								/>
							</Box>
						)
					}

					// Readonly or editable field
					return (
						<Text key={item.key}>
							<Text bold color={isSelected ? "blueBright" : undefined}>
								{isSelected ? "❯" : " "}{" "}
							</Text>
							<Text color={isSelected ? "white" : "gray"}>{item.label}: </Text>
							<Text color={item.type === "readonly" ? "gray" : "blueBright"}>
								{typeof item.value === "string" ? item.value : String(item.value)}
							</Text>
							{item.type === "editable" && isSelected && (
								<Text color="gray" dimColor>
									{" "}
									(Tab to edit)
								</Text>
							)}
						</Text>
					)
				})}
			</Box>
		)
	}

	return (
		<Panel currentTab={currentTab} label="Settings" tabs={TABS}>
			{renderContent()}
		</Panel>
	)
}
