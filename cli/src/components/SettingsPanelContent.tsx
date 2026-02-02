/**
 * Settings panel content for inline display in ChatView
 * Uses a tabbed interface: API, Auto Approve, Features, Other
 */

import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { ApiProvider } from "@shared/api"
import { getProviderModelIdKey, ProviderToApiKeyMap } from "@shared/storage"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import { Box, Text, useInput } from "ink"
import Spinner from "ink-spinner"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { buildApiHandler } from "@/core/api"
import type { Controller } from "@/core/controller"
import { StateManager } from "@/core/storage/StateManager"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { ClineAccountService } from "@/services/account/ClineAccountService"
import { AuthService, ClineAccountOrganization } from "@/services/auth/AuthService"
import { openExternal } from "@/utils/env"
import { version as CLI_VERSION } from "../../package.json"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { isMouseEscapeSequence } from "../utils/input"
import { applyProviderConfig } from "../utils/provider-config"
import { ApiKeyInput } from "./ApiKeyInput"
import { type BedrockConfig, BedrockSetup } from "./BedrockSetup"
import { Checkbox } from "./Checkbox"
import {
	FeaturedModelPicker,
	getFeaturedModelAtIndex,
	getFeaturedModelMaxIndex,
	isBrowseAllSelected,
} from "./FeaturedModelPicker"
import { LanguagePicker } from "./LanguagePicker"
import { getDefaultModelId, hasModelPicker, ModelPicker } from "./ModelPicker"
import { OrganizationPicker } from "./OrganizationPicker"
import { Panel, PanelTab } from "./Panel"
import { getProviderLabel, ProviderPicker } from "./ProviderPicker"

interface SettingsPanelContentProps {
	onClose: () => void
	controller?: Controller
	initialMode?: "model-picker" | "featured-models"
	initialModelKey?: "actModelId" | "planModelId"
}

type SettingsTab = "api" | "auto-approve" | "features" | "other" | "account"

interface ListItem {
	key: string
	label: string
	type: "checkbox" | "readonly" | "editable" | "separator" | "header" | "spacer" | "action"
	value: string | boolean
	description?: string
	isSubItem?: boolean
	parentKey?: string
}

const TABS: PanelTab[] = [
	{ key: "api", label: "API" },
	{ key: "auto-approve", label: "Auto-approve" },
	{ key: "features", label: "Features" },
	{ key: "account", label: "Account" },
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
} as const

type FeatureKey = keyof typeof FEATURE_SETTINGS

/**
 * Format balance as currency (balance is in microcredits, divide by 1000000)
 */
function formatBalance(balance: number | null): string {
	if (balance === null || balance === undefined) {
		return "..."
	}
	return `$${(balance / 1000000).toFixed(2)}`
}

export const SettingsPanelContent: React.FC<SettingsPanelContentProps> = ({
	onClose,
	controller,
	initialMode,
	initialModelKey,
}) => {
	const { isRawModeSupported } = useStdinContext()
	const stateManager = StateManager.get()

	// UI state
	const [currentTab, setCurrentTab] = useState<SettingsTab>("api")
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [isEditing, setIsEditing] = useState(false)
	const [isPickingModel, setIsPickingModel] = useState(initialMode === "model-picker")
	const [pickingModelKey, setPickingModelKey] = useState<"actModelId" | "planModelId" | null>(
		initialMode ? (initialModelKey ?? "actModelId") : null,
	)
	const [isPickingFeaturedModel, setIsPickingFeaturedModel] = useState(initialMode === "featured-models")
	const [featuredModelIndex, setFeaturedModelIndex] = useState(0)
	const [isPickingProvider, setIsPickingProvider] = useState(false)
	const [isPickingLanguage, setIsPickingLanguage] = useState(false)
	const [isEnteringApiKey, setIsEnteringApiKey] = useState(false)
	const [isConfiguringBedrock, setIsConfiguringBedrock] = useState(false)
	const [isWaitingForCodexAuth, setIsWaitingForCodexAuth] = useState(false)
	const [codexAuthError, setCodexAuthError] = useState<string | null>(null)
	const [pendingProvider, setPendingProvider] = useState<string | null>(null)
	const [apiKeyValue, setApiKeyValue] = useState("")
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

	// Account tab state
	const [accountEmail, setAccountEmail] = useState<string | null>(null)
	const [accountBalance, setAccountBalance] = useState<number | null>(null)
	const [accountOrganization, setAccountOrganization] = useState<ClineAccountOrganization | null>(null)
	const [accountOrganizations, setAccountOrganizations] = useState<ClineAccountOrganization[] | null>(null)
	const [isAccountLoading, setIsAccountLoading] = useState(false)
	const [isPickingOrganization, setIsPickingOrganization] = useState(false)
	const [isWaitingForClineAuth, setIsWaitingForClineAuth] = useState(false)
	const [accountChecked, setAccountChecked] = useState(false) // Tracks if we've already checked auth

	// Get current provider and model info
	const [provider, setProvider] = useState<string>(
		() =>
			stateManager.getApiConfiguration().actModeApiProvider ||
			stateManager.getApiConfiguration().planModeApiProvider ||
			"not configured",
	)
	// Refresh trigger to force re-reading model IDs from state
	const [modelRefreshKey, setModelRefreshKey] = useState(0)
	const refreshModelIds = useCallback(() => setModelRefreshKey((k) => k + 1), [])

	// Read model IDs from state (re-reads when refreshKey changes)
	const { actModelId, planModelId } = useMemo(() => {
		const apiConfig = stateManager.getApiConfiguration()
		const currentProvider = apiConfig.actModeApiProvider
		if (!currentProvider) {
			return { actModelId: "", planModelId: "" }
		}
		const actKey = getProviderModelIdKey(currentProvider as ApiProvider, "act")
		const planKey = getProviderModelIdKey(currentProvider as ApiProvider, "plan")
		return {
			actModelId: (stateManager.getGlobalSettingsKey(actKey as string) as string) || "",
			planModelId: (stateManager.getGlobalSettingsKey(planKey as string) as string) || "",
		}
	}, [modelRefreshKey, stateManager])

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

	// Fetch account info (reused pattern from AccountInfoView.tsx)
	const fetchAccountInfo = useCallback(async () => {
		if (!controller) {
			return
		}
		try {
			setIsAccountLoading(true)

			const authService = AuthService.getInstance(controller)

			// Wait for auth to be restored
			let authInfo = authService.getInfo()
			let attempts = 0
			const maxAttempts = 20 // 2 seconds max
			while (!authInfo?.user?.uid && attempts < maxAttempts) {
				await new Promise((resolve) => setTimeout(resolve, 100))
				authInfo = authService.getInfo()
				attempts++
			}

			// Get user info
			if (authInfo?.user?.email) {
				setAccountEmail(authInfo.user.email)
			} else {
				setAccountEmail(null)
				setIsAccountLoading(false)
				return
			}

			// Get organization info
			const organizations = authService.getUserOrganizations()
			if (organizations) {
				setAccountOrganizations(organizations)
				const activeOrg = organizations.find((org) => org.active)
				setAccountOrganization(activeOrg || null)
			}

			// Fetch credit balance
			try {
				const accountService = ClineAccountService.getInstance()
				const activeOrgId = authService.getActiveOrganizationId()

				if (activeOrgId) {
					const orgBalance = await accountService.fetchOrganizationCreditsRPC(activeOrgId)
					if (orgBalance?.balance !== undefined) {
						setAccountBalance(orgBalance.balance)
					}
				} else {
					const balanceData = await accountService.fetchBalanceRPC()
					if (balanceData?.balance !== undefined) {
						setAccountBalance(balanceData.balance)
					}
				}
			} catch {
				// Balance fetch failed, but we can still show other info
			}
		} catch {
			// Error fetching account info
		} finally {
			setIsAccountLoading(false)
			setAccountChecked(true)
		}
	}, [controller])

	// Handle Cline login - starts OAuth flow
	const handleClineLogin = useCallback(() => {
		if (!controller) {
			return
		}
		// Set waiting state first (synchronously) to show the waiting UI immediately
		setIsWaitingForClineAuth(true)
		// Then start the auth request (async, but we don't need to await)
		AuthService.getInstance(controller)
			.createAuthRequest()
			.catch(() => {
				setIsWaitingForClineAuth(false)
			})
	}, [controller])

	// Handle Cline logout
	const handleClineLogout = useCallback(async () => {
		if (!controller) {
			return
		}
		await AuthService.getInstance(controller).handleDeauth()
		setAccountEmail(null)
		setAccountBalance(null)
		setAccountOrganization(null)
		setAccountOrganizations(null)
		setAccountChecked(true) // Mark as checked so we don't re-fetch
	}, [controller])

	// Handle organization selection
	const handleOrganizationSelect = useCallback(
		async (orgId: string | null) => {
			if (!controller) {
				return
			}
			setIsPickingOrganization(false)
			try {
				await ClineAccountService.getInstance().switchAccount(orgId || undefined)
				// Refetch to get updated auth info with new active org
				await AuthService.getInstance(controller).restoreRefreshTokenAndRetrieveAuthInfo()
				fetchAccountInfo()
			} catch {
				// Error switching organization
			}
		},
		[controller, fetchAccountInfo],
	)

	// Fetch account info when switching to account tab (only if not already checked)
	useEffect(() => {
		if (currentTab === "account" && !accountEmail && !isAccountLoading && !accountChecked && controller) {
			fetchAccountInfo()
		}
	}, [currentTab, accountEmail, isAccountLoading, accountChecked, controller, fetchAccountInfo])

	// Subscribe to auth status updates when waiting for Cline auth
	useEffect(() => {
		if (!isWaitingForClineAuth || !controller) {
			return
		}

		let cancelled = false
		const authService = AuthService.getInstance(controller)

		const responseHandler = async (authState: { user?: { email?: string } }) => {
			if (cancelled) {
				return
			}
			if (authState.user?.email) {
				setIsWaitingForClineAuth(false)
				setAccountChecked(false) // Reset so fetchAccountInfo can run
				await applyProviderConfig({ providerId: "cline", controller })
				setProvider("cline")
				refreshModelIds()
				fetchAccountInfo()
			}
		}

		authService.subscribeToAuthStatusUpdate(controller, {}, responseHandler, `settings-auth-${Date.now()}`)

		return () => {
			cancelled = true
		}
	}, [isWaitingForClineAuth, controller, fetchAccountInfo])

	// Build items list based on current tab
	const items: ListItem[] = useMemo(() => {
		// OpenAI Native, Codex, and GPT models don't support thinking budget (they use reasoning effort)
		const isGptModel = actModelId?.toLowerCase().includes("gpt") || planModelId?.toLowerCase().includes("gpt")
		const showThinkingOption = provider !== "openai-native" && provider !== "openai-codex" && !isGptModel

		switch (currentTab) {
			case "api":
				return [
					{
						key: "provider",
						label: "Provider",
						type: "editable",
						value: provider ? getProviderLabel(provider) : "not configured",
					},
					...(provider === "cline"
						? [{ key: "viewAccount", label: "View account", type: "action" as const, value: "" }]
						: []),
					...(separateModels
						? [
								{ key: "spacer0", label: "", type: "spacer" as const, value: "" },
								{ key: "actHeader", label: "Act Mode", type: "header" as const, value: "" },
								{
									key: "actModelId",
									label: "Model ID",
									type: "editable" as const,
									value: actModelId || "not set",
								},
								...(showThinkingOption
									? [
											{
												key: "actThinkingEnabled",
												label: "Enable thinking",
												type: "checkbox" as const,
												value: actThinkingEnabled,
											},
										]
									: []),
								{ key: "planHeader", label: "Plan Mode", type: "header" as const, value: "" },
								{
									key: "planModelId",
									label: "Model ID",
									type: "editable" as const,
									value: planModelId || "not set",
								},
								...(showThinkingOption
									? [
											{
												key: "planThinkingEnabled",
												label: "Enable thinking",
												type: "checkbox" as const,
												value: planThinkingEnabled,
											},
										]
									: []),
								{ key: "spacer1", label: "", type: "spacer" as const, value: "" },
							]
						: [
								{
									key: "actModelId",
									label: "Model ID",
									type: "editable" as const,
									value: actModelId || "not set",
								},
								...(showThinkingOption
									? [
											{
												key: "actThinkingEnabled",
												label: "Enable thinking",
												type: "checkbox" as const,
												value: actThinkingEnabled,
											},
										]
									: []),
							]),
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
						description: "System alerts when Cline needs your attention",
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
						value: telemetry !== "disabled",
						description: "Help improve Cline by sending anonymous usage data",
					},
					{ key: "separator", label: "", type: "separator", value: "" },
					{ key: "version", label: "", type: "readonly", value: `Cline v${CLI_VERSION}` },
				]

			case "account":
				// If loading, return empty (loading spinner shown in render)
				if (isAccountLoading) {
					return []
				}
				// If not logged in, show login option
				if (!accountEmail) {
					return [{ key: "login", label: "Sign in with Cline", type: "action", value: "" }]
				}
				// Logged in - show account info
				const accountItems: ListItem[] = [
					{ key: "email", label: "Email", type: "readonly", value: accountEmail },
					{ key: "balance", label: "Credits", type: "readonly", value: formatBalance(accountBalance) },
				]
				// Organization selector - only show if user has organizations
				if (accountOrganizations && accountOrganizations.length > 0) {
					accountItems.push({
						key: "organization",
						label: "Organization",
						type: "editable",
						value: accountOrganization ? accountOrganization.name : "Personal",
					})
				} else {
					accountItems.push({
						key: "organization",
						label: "Account",
						type: "readonly",
						value: "Personal",
					})
				}
				accountItems.push({ key: "separator", label: "", type: "separator", value: "" })
				accountItems.push({ key: "logout", label: "Sign out", type: "action", value: "" })
				return accountItems

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
		isAccountLoading,
		accountEmail,
		accountBalance,
		accountOrganization,
		accountOrganizations,
	])

	// Reset selection when changing tabs
	const handleTabChange = useCallback((tabKey: string) => {
		setCurrentTab(tabKey as SettingsTab)
		setSelectedIndex(0)
		setIsEditing(false)
		setIsPickingModel(false)
		setPickingModelKey(null)
		setIsPickingProvider(false)
		setIsPickingLanguage(false)
		setIsEnteringApiKey(false)
		setPendingProvider(null)
		setApiKeyValue("")
		setIsPickingOrganization(false)
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
		if (!item || item.type === "readonly" || item.type === "separator" || item.type === "header" || item.type === "spacer")
			return

		if (item.type === "action") {
			// Action items trigger their handler directly
			if (item.key === "login") {
				handleClineLogin()
				return
			}
			if (item.key === "logout") {
				handleClineLogout()
				return
			}
			if (item.key === "viewAccount") {
				handleTabChange("account")
				return
			}
			return
		}

		if (item.type === "editable") {
			// For provider field, use the provider picker
			if (item.key === "provider") {
				setIsPickingProvider(true)
				return
			}
			// For model ID fields, check if we should use the model picker
			if ((item.key === "actModelId" || item.key === "planModelId") && hasModelPicker(provider)) {
				setPickingModelKey(item.key as "actModelId" | "planModelId")
				// For Cline provider, show featured models first
				if (provider === "cline") {
					setFeaturedModelIndex(0)
					setIsPickingFeaturedModel(true)
				} else {
					setIsPickingModel(true)
				}
				return
			}
			// For language field, use the language picker
			if (item.key === "language") {
				setIsPickingLanguage(true)
				return
			}
			// For organization field, use the organization picker
			if (item.key === "organization" && accountOrganizations && accountOrganizations.length > 0) {
				setIsPickingOrganization(true)
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
			// When disabling separate models, sync plan model to act model
			if (!newValue) {
				const currentProvider = stateManager.getApiConfiguration().actModeApiProvider
				if (currentProvider) {
					const actKey = getProviderModelIdKey(currentProvider as ApiProvider, "act")
					const planKey = getProviderModelIdKey(currentProvider as ApiProvider, "plan")
					const actModel = stateManager.getGlobalSettingsKey(actKey as string)
					if (planKey) stateManager.setGlobalState(planKey, actModel)
				}
			}
			return
		}

		// Thinking toggles - set budget to 1024 when enabled, 0 when disabled
		if (item.key === "actThinkingEnabled") {
			setActThinkingEnabled(newValue)
			stateManager.setGlobalState("actModeThinkingBudgetTokens", newValue ? 1024 : 0)
			// Rebuild API handler to apply thinking budget change
			if (controller?.task) {
				const currentMode = stateManager.getGlobalSettingsKey("mode")
				const apiConfig = stateManager.getApiConfiguration()
				controller.task.api = buildApiHandler({ ...apiConfig, ulid: controller.task.ulid }, currentMode)
			}
			return
		}
		if (item.key === "planThinkingEnabled") {
			setPlanThinkingEnabled(newValue)
			stateManager.setGlobalState("planModeThinkingBudgetTokens", newValue ? 1024 : 0)
			// Rebuild API handler to apply thinking budget change
			if (controller?.task) {
				const currentMode = stateManager.getGlobalSettingsKey("mode")
				const apiConfig = stateManager.getApiConfiguration()
				controller.task.api = buildApiHandler({ ...apiConfig, ulid: controller.task.ulid }, currentMode)
			}
			return
		}

		// Other tab
		if (item.key === "telemetry") {
			const newTelemetry: TelemetrySetting = newValue ? "enabled" : "disabled"
			setTelemetry(newTelemetry)
			stateManager.setGlobalState("telemetrySetting", newTelemetry)
			// Flush synchronously before continuing - must complete before app can exit
			void stateManager.flushPendingState().then(() => {
				// Update telemetry providers to respect the new setting
				controller?.updateTelemetrySetting(newTelemetry)
			})
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
	}, [
		items,
		selectedIndex,
		stateManager,
		autoApproveSettings,
		toggleFeature,
		handleClineLogin,
		handleClineLogout,
		accountOrganizations,
	])

	// Handle model selection from picker
	const handleModelSelect = useCallback(
		async (modelId: string) => {
			if (!pickingModelKey) return
			const currentProvider = stateManager.getApiConfiguration().actModeApiProvider
			if (!currentProvider) return
			// Use provider-specific model ID keys (e.g., cline uses actModeOpenRouterModelId)
			const actKey = getProviderModelIdKey(currentProvider as ApiProvider, "act")
			const planKey = getProviderModelIdKey(currentProvider as ApiProvider, "plan")

			// For cline/openrouter providers, also set model info (like webview does)
			let modelInfo
			if (currentProvider === "cline" || currentProvider === "openrouter") {
				const openRouterModels = await controller?.readOpenRouterModels()
				modelInfo = openRouterModels?.[modelId]
			}

			if (separateModels) {
				// Only update the selected mode's model
				const stateKey = pickingModelKey === "actModelId" ? actKey : planKey
				if (stateKey) stateManager.setGlobalState(stateKey, modelId)
				// Set model info for the selected mode
				if (modelInfo) {
					const infoKey =
						pickingModelKey === "actModelId" ? "actModeOpenRouterModelInfo" : "planModeOpenRouterModelInfo"
					stateManager.setGlobalState(infoKey, modelInfo)
				}
			} else {
				// Update both modes to keep them in sync
				if (actKey) stateManager.setGlobalState(actKey, modelId)
				if (planKey) stateManager.setGlobalState(planKey, modelId)
				// Set model info for both modes
				if (modelInfo) {
					stateManager.setGlobalState("actModeOpenRouterModelInfo", modelInfo)
					stateManager.setGlobalState("planModeOpenRouterModelInfo", modelInfo)
				}
			}

			// Flush pending state to ensure model ID is persisted
			await stateManager.flushPendingState()

			// Rebuild API handler if there's an active task
			const apiConfig = stateManager.getApiConfiguration()
			if (controller?.task) {
				const currentMode = stateManager.getGlobalSettingsKey("mode")
				controller.task.api = buildApiHandler({ ...apiConfig, ulid: controller.task.ulid }, currentMode)
			}

			refreshModelIds()
			setIsPickingModel(false)
			setPickingModelKey(null)

			// If opened from /models command, close the entire settings panel
			if (initialMode) {
				onClose()
			}
		},
		[pickingModelKey, separateModels, stateManager, controller, refreshModelIds, initialMode, onClose],
	)

	// Handle language selection from picker
	const handleLanguageSelect = useCallback(
		(language: string) => {
			setPreferredLanguage(language)
			stateManager.setGlobalState("preferredLanguage", language)
			setIsPickingLanguage(false)
		},
		[stateManager],
	)

	// Handle OpenAI Codex OAuth flow
	const startCodexAuth = useCallback(async () => {
		try {
			setIsWaitingForCodexAuth(true)
			setCodexAuthError(null)

			// Get the authorization URL and start the callback server
			const authUrl = openAiCodexOAuthManager.startAuthorizationFlow()

			// Open browser to authorization URL
			await openExternal(authUrl)

			// Wait for the callback
			await openAiCodexOAuthManager.waitForCallback()

			// Success - apply provider config
			await applyProviderConfig({ providerId: "openai-codex", controller })
			setProvider("openai-codex")
			refreshModelIds()
			setIsWaitingForCodexAuth(false)
		} catch (error) {
			openAiCodexOAuthManager.cancelAuthorizationFlow()
			setCodexAuthError(error instanceof Error ? error.message : String(error))
			setIsWaitingForCodexAuth(false)
		}
	}, [controller])

	const handleProviderSelect = useCallback(
		(providerId: string) => {
			// Special handling for Cline - uses OAuth (but skip if already logged in)
			if (providerId === "cline") {
				setIsPickingProvider(false)
				// Check if already logged in
				const authInfo = AuthService.getInstance(controller).getInfo()
				if (authInfo?.user?.email) {
					// Already logged in - just set the provider
					applyProviderConfig({ providerId: "cline", controller })
					setProvider("cline")
					refreshModelIds()
				} else {
					// Not logged in - trigger OAuth
					handleClineLogin()
				}
				return
			}

			// Special handling for OpenAI Codex - uses OAuth instead of API key
			if (providerId === "openai-codex") {
				setIsPickingProvider(false)
				startCodexAuth()
				return
			}

			// Special handling for Bedrock - needs multi-field configuration
			if (providerId === "bedrock") {
				setPendingProvider(providerId)
				setIsPickingProvider(false)
				setIsConfiguringBedrock(true)
				return
			}

			// Check if this provider needs an API key
			const keyField = ProviderToApiKeyMap[providerId as keyof typeof ProviderToApiKeyMap]
			if (keyField) {
				// Provider needs an API key - go to API key entry mode
				// Pre-fill with existing key if configured
				const apiConfig = stateManager.getApiConfiguration()
				const fieldName = Array.isArray(keyField) ? keyField[0] : keyField
				const existingKey = (apiConfig as Record<string, string>)[fieldName] || ""
				setPendingProvider(providerId)
				setApiKeyValue(existingKey)
				setIsPickingProvider(false)
				setIsEnteringApiKey(true)
			} else {
				// Provider doesn't need an API key (rare) - just set it
				applyProviderConfig({ providerId, controller })
				setProvider(providerId)
				refreshModelIds()
				setIsPickingProvider(false)
			}
		},
		[stateManager, startCodexAuth, handleClineLogin, controller, refreshModelIds],
	)

	// Handle API key submission after provider selection
	const handleApiKeySubmit = useCallback(
		async (submittedValue: string) => {
			if (!pendingProvider || !submittedValue.trim()) {
				return
			}

			await applyProviderConfig({ providerId: pendingProvider, apiKey: submittedValue.trim(), controller })
			setProvider(pendingProvider)
			refreshModelIds()
			setIsEnteringApiKey(false)
			setPendingProvider(null)
			setApiKeyValue("")
		},
		[pendingProvider, controller, refreshModelIds],
	)

	// Handle Bedrock configuration complete
	const handleBedrockComplete = useCallback(
		(bedrockConfig: BedrockConfig) => {
			const config: Record<string, unknown> = {
				actModeApiProvider: "bedrock",
				planModeApiProvider: "bedrock",
				apiProvider: "bedrock",
				awsAuthentication: bedrockConfig.awsAuthentication,
				awsRegion: bedrockConfig.awsRegion,
				awsUseCrossRegionInference: bedrockConfig.awsUseCrossRegionInference,
			}

			const defaultModelId = getDefaultModelId("bedrock")
			if (defaultModelId) {
				// Use provider-specific model ID keys
				const actModelKey = getProviderModelIdKey("bedrock" as ApiProvider, "act")
				const planModelKey = getProviderModelIdKey("bedrock" as ApiProvider, "plan")
				if (actModelKey) config[actModelKey] = defaultModelId
				if (planModelKey) config[planModelKey] = defaultModelId
			}

			if (bedrockConfig.awsProfile !== undefined) config.awsProfile = bedrockConfig.awsProfile
			if (bedrockConfig.awsAccessKey) config.awsAccessKey = bedrockConfig.awsAccessKey
			if (bedrockConfig.awsSecretKey) config.awsSecretKey = bedrockConfig.awsSecretKey
			if (bedrockConfig.awsSessionToken) config.awsSessionToken = bedrockConfig.awsSessionToken

			stateManager.setApiConfiguration(config as Record<string, string>)

			// Close Bedrock config first, then flush state async
			setProvider("bedrock")
			refreshModelIds()
			setIsConfiguringBedrock(false)
			setPendingProvider(null)

			// Flush state and rebuild API handler in background
			stateManager.flushPendingState().then(() => {
				if (controller?.task) {
					const currentMode = stateManager.getGlobalSettingsKey("mode")
					const apiConfig = stateManager.getApiConfiguration()
					controller.task.api = buildApiHandler({ ...apiConfig, ulid: controller.task.ulid }, currentMode)
				}
			})
		},
		[stateManager, controller],
	)

	// Handle saving edited value
	const handleSave = useCallback(() => {
		const item = items[selectedIndex]
		if (!item) return

		switch (item.key) {
			case "actModelId":
			case "planModelId": {
				// Use provider-specific model ID keys (e.g., cline uses actModeOpenRouterModelId)
				const currentProvider = stateManager.getApiConfiguration().actModeApiProvider
				if (!currentProvider) break
				const actKey = getProviderModelIdKey(currentProvider as ApiProvider, "act")
				const planKey = getProviderModelIdKey(currentProvider as ApiProvider, "plan")

				if (separateModels) {
					// Only update the selected mode's model
					const stateKey = item.key === "actModelId" ? actKey : planKey
					if (stateKey) stateManager.setGlobalState(stateKey, editValue || undefined)
				} else {
					// Update both modes to keep them in sync
					if (actKey) stateManager.setGlobalState(actKey, editValue || undefined)
					if (planKey) stateManager.setGlobalState(planKey, editValue || undefined)
				}
				break
			}
			case "language":
				setPreferredLanguage(editValue)
				stateManager.setGlobalState("preferredLanguage", editValue)
				break
		}
		setIsEditing(false)
	}, [items, selectedIndex, editValue, separateModels, stateManager])

	// Navigate to next/prev item, skipping non-interactive items
	const navigateItems = useCallback(
		(direction: "up" | "down") => {
			setSelectedIndex((i) => {
				let next = direction === "up" ? (i > 0 ? i - 1 : items.length - 1) : i < items.length - 1 ? i + 1 : 0

				// Skip separators, headers, and spacers
				const skipTypes = ["separator", "header", "spacer"]
				while (skipTypes.includes(items[next]?.type) && next !== i) {
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
	// Disable when in modes where child components handle input
	useInput(
		(input, key) => {
			// Filter out mouse escape sequences
			if (isMouseEscapeSequence(input)) {
				return
			}

			// Provider picker mode - escape to close, input is handled by ProviderPicker
			if (isPickingProvider) {
				if (key.escape) {
					setIsPickingProvider(false)
				}
				return
			}

			// Featured model picker mode (Cline provider)
			if (isPickingFeaturedModel) {
				const maxIndex = getFeaturedModelMaxIndex()

				if (key.escape) {
					setIsPickingFeaturedModel(false)
					setPickingModelKey(null)
					// If opened from /models command, close the entire settings panel
					if (initialMode) {
						onClose()
					}
				} else if (key.upArrow) {
					setFeaturedModelIndex((prev) => (prev > 0 ? prev - 1 : maxIndex))
				} else if (key.downArrow) {
					setFeaturedModelIndex((prev) => (prev < maxIndex ? prev + 1 : 0))
				} else if (key.return) {
					if (isBrowseAllSelected(featuredModelIndex)) {
						// Switch to full ModelPicker
						setIsPickingFeaturedModel(false)
						setIsPickingModel(true)
					} else {
						const selectedModel = getFeaturedModelAtIndex(featuredModelIndex)
						if (selectedModel && pickingModelKey) {
							handleModelSelect(selectedModel.id)
							setIsPickingFeaturedModel(false)
							setPickingModelKey(null)
						}
					}
				}
				return
			}

			// Model picker mode - escape to close, input is handled by ModelPicker
			if (isPickingModel) {
				if (key.escape) {
					setIsPickingModel(false)
					setPickingModelKey(null)
					// If opened from /models command, close the entire settings panel
					if (initialMode) {
						onClose()
					}
				}
				return
			}

			// Language picker mode - escape to close, input is handled by LanguagePicker
			if (isPickingLanguage) {
				if (key.escape) {
					setIsPickingLanguage(false)
				}
				return
			}

			// Codex OAuth waiting mode - escape to cancel
			if (isWaitingForCodexAuth) {
				if (key.escape) {
					openAiCodexOAuthManager.cancelAuthorizationFlow()
					setIsWaitingForCodexAuth(false)
				}
				return
			}

			// Codex OAuth error mode - any key to dismiss
			if (codexAuthError) {
				setCodexAuthError(null)
				return
			}

			// Organization picker mode - escape to close, input is handled by OrganizationPicker
			if (isPickingOrganization) {
				if (key.escape) {
					setIsPickingOrganization(false)
				}
				return
			}

			// Cline OAuth waiting mode - escape to cancel
			if (isWaitingForClineAuth) {
				if (key.escape) {
					setIsWaitingForClineAuth(false)
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
		{ isActive: isRawModeSupported && !isEnteringApiKey && !isConfiguringBedrock },
	)

	// Render content
	const renderContent = () => {
		if (isPickingProvider) {
			return (
				<Box flexDirection="column">
					<Text bold color={COLORS.primaryBlue}>
						Select Provider
					</Text>
					<Box marginTop={1}>
						<ProviderPicker isActive={isPickingProvider} onSelect={handleProviderSelect} />
					</Box>
					<Box marginTop={1}>
						<Text color="gray">Type to search, arrows to navigate, Enter to select, Esc to cancel</Text>
					</Box>
				</Box>
			)
		}

		if (isEnteringApiKey && pendingProvider) {
			return (
				<ApiKeyInput
					isActive={isEnteringApiKey}
					onCancel={() => {
						setIsEnteringApiKey(false)
						setPendingProvider(null)
						setApiKeyValue("")
					}}
					onChange={setApiKeyValue}
					onSubmit={handleApiKeySubmit}
					providerName={getProviderLabel(pendingProvider)}
					value={apiKeyValue}
				/>
			)
		}

		if (isConfiguringBedrock) {
			return (
				<BedrockSetup
					isActive={isConfiguringBedrock}
					onCancel={() => {
						setIsConfiguringBedrock(false)
						setPendingProvider(null)
					}}
					onComplete={handleBedrockComplete}
				/>
			)
		}

		if (isWaitingForCodexAuth) {
			return (
				<Box flexDirection="column">
					<Box>
						<Text color={COLORS.primaryBlue}>
							<Spinner type="dots" />
						</Text>
						<Text color="white"> Waiting for ChatGPT sign-in...</Text>
					</Box>
					<Box marginTop={1}>
						<Text color="gray">Sign in with your ChatGPT account in the browser.</Text>
					</Box>
					<Text color="gray">Requires ChatGPT Plus, Pro, or Team subscription.</Text>
					<Box marginTop={1}>
						<Text color="gray">Esc to cancel</Text>
					</Box>
				</Box>
			)
		}

		if (codexAuthError) {
			return (
				<Box flexDirection="column">
					<Text bold color="red">
						ChatGPT sign-in failed
					</Text>
					<Box marginTop={1}>
						<Text color="yellow">{codexAuthError}</Text>
					</Box>
					<Box marginTop={1}>
						<Text color="gray">Press any key to continue</Text>
					</Box>
				</Box>
			)
		}

		if (isPickingFeaturedModel && pickingModelKey) {
			const label = pickingModelKey === "actModelId" ? "Model ID (Act)" : "Model ID (Plan)"
			return (
				<FeaturedModelPicker
					helpText="Arrows to navigate, Enter to select, Esc to cancel"
					selectedIndex={featuredModelIndex}
					title={`Select: ${label}`}
				/>
			)
		}

		if (isPickingModel && pickingModelKey) {
			const label = pickingModelKey === "actModelId" ? "Model ID (Act)" : "Model ID (Plan)"
			return (
				<Box flexDirection="column">
					<Text bold color={COLORS.primaryBlue}>
						Select: {label}
					</Text>
					<Box marginTop={1}>
						<ModelPicker
							controller={controller}
							isActive={isPickingModel}
							onChange={() => {}}
							onSubmit={handleModelSelect}
							provider={provider}
						/>
					</Box>
					<Box marginTop={1}>
						<Text color="gray">Type to search, arrows to navigate, Enter to select, Esc to cancel</Text>
					</Box>
				</Box>
			)
		}

		if (isPickingLanguage) {
			return (
				<Box flexDirection="column">
					<Text bold color={COLORS.primaryBlue}>
						Select Language
					</Text>
					<Box marginTop={1}>
						<LanguagePicker isActive={isPickingLanguage} onSelect={handleLanguageSelect} />
					</Box>
					<Box marginTop={1}>
						<Text color="gray">Type to search, arrows to navigate, Enter to select, Esc to cancel</Text>
					</Box>
				</Box>
			)
		}

		if (isPickingOrganization && accountOrganizations) {
			return (
				<Box flexDirection="column">
					<Text bold color={COLORS.primaryBlue}>
						Select Organization
					</Text>
					<Box marginTop={1}>
						<OrganizationPicker
							isActive={isPickingOrganization}
							onSelect={handleOrganizationSelect}
							organizations={accountOrganizations}
						/>
					</Box>
					<Box marginTop={1}>
						<Text color="gray">Arrows to navigate, Enter to select, Esc to cancel</Text>
					</Box>
				</Box>
			)
		}

		if (isWaitingForClineAuth) {
			return (
				<Box flexDirection="column">
					<Box>
						<Text color={COLORS.primaryBlue}>
							<Spinner type="dots" />
						</Text>
						<Text color="white"> Waiting for Cline sign-in...</Text>
					</Box>
					<Box marginTop={1}>
						<Text color="gray">Complete sign-in in your browser.</Text>
					</Box>
					<Box marginTop={1}>
						<Text color="gray">Esc to cancel</Text>
					</Box>
				</Box>
			)
		}

		// Account tab - loading state
		if (currentTab === "account" && isAccountLoading) {
			return (
				<Box>
					<Text color={COLORS.primaryBlue}>
						<Spinner type="dots" />
					</Text>
					<Text color="gray"> Loading account info...</Text>
				</Box>
			)
		}

		// Account tab - logged out state with pitch
		if (currentTab === "account" && !accountEmail && !isAccountLoading) {
			return (
				<Box flexDirection="column">
					<Text color="white">Sign in to access Cline features:</Text>
					<Box flexDirection="column" marginTop={1}>
						<Text color="gray"> - Free access to frontier AI models</Text>
						<Text color="gray"> - Built-in web search capabilities</Text>
						<Text color="gray"> - Team management and shared billing</Text>
					</Box>
					<Box marginTop={1}>
						{items.map((item, idx) => {
							const isSelected = idx === selectedIndex
							return (
								<Text key={item.key}>
									<Text bold color={isSelected ? COLORS.primaryBlue : undefined}>
										{isSelected ? "❯" : " "}{" "}
									</Text>
									<Text color={isSelected ? COLORS.primaryBlue : "white"}>{item.label}</Text>
									{isSelected && <Text color="gray"> (Enter)</Text>}
								</Text>
							)
						})}
					</Box>
				</Box>
			)
		}

		if (isEditing) {
			const item = items[selectedIndex]
			return (
				<Box flexDirection="column">
					<Text bold color={COLORS.primaryBlue}>
						Edit: {item?.label}
					</Text>
					<Box marginTop={1}>
						<Text color="white">{editValue}</Text>
						<Text color="gray">|</Text>
					</Box>
					<Text color="gray">Enter to save, Esc to cancel</Text>
				</Box>
			)
		}

		return (
			<Box flexDirection="column">
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

					if (item.type === "spacer") {
						return <Box key={item.key} marginTop={1} />
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

					// Action item (button-like, no value display)
					if (item.type === "action") {
						return (
							<Text key={item.key}>
								<Text bold color={isSelected ? COLORS.primaryBlue : undefined}>
									{isSelected ? "❯" : " "}{" "}
								</Text>
								<Text color={isSelected ? COLORS.primaryBlue : "white"}>{item.label}</Text>
								{isSelected && <Text color="gray"> (Enter)</Text>}
							</Text>
						)
					}

					// Readonly or editable field
					return (
						<Text key={item.key}>
							<Text bold color={isSelected ? COLORS.primaryBlue : undefined}>
								{isSelected ? "❯" : " "}{" "}
							</Text>
							{item.label && <Text color={isSelected ? COLORS.primaryBlue : "white"}>{item.label}: </Text>}
							<Text color={item.type === "readonly" ? "gray" : COLORS.primaryBlue}>
								{typeof item.value === "string" ? item.value : String(item.value)}
							</Text>
							{item.type === "editable" && isSelected && <Text color="gray"> (Tab to edit)</Text>}
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
