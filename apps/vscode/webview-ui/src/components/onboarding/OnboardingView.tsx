import { buildModelInfoNameMap, type ModelInfo, openAiModelInfoSafeDefaults, resolveClinePassModelInfo } from "@shared/api"
import type { OnboardingModel, OnboardingModelGroup, OpenRouterModelInfo } from "@shared/proto/index.cline"
import { AlertCircleIcon, CircleCheckIcon, CircleIcon, ListIcon, LoaderCircleIcon, ZapIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ClineLogoWhite from "@/assets/ClineLogoWhite"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Item, ItemContent, ItemDescription, ItemHeader, ItemMedia, ItemTitle } from "@/components/ui/item"
import { CLINE_PASS_FEATURE_FLAG } from "@/constants/featureFlags"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useHasFeatureFlag } from "@/hooks/useFeatureFlag"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import { cn } from "@/lib/utils"
import { AccountServiceClient, StateServiceClient } from "@/services/grpc-client"
import ApiConfigurationSection from "../settings/sections/ApiConfigurationSection"
import { useApiConfigurationHandlers } from "../settings/utils/useApiConfigurationHandlers"
import WelcomeView from "../welcome/WelcomeView"
import { setPendingClinePassSubscribe } from "./clinePassSubscribe"
import {
	CLINEPASS_GROUP,
	getCapabilities,
	getClineUIOnboardingGroups,
	getOnboardingGroupDisplayName,
	getPriceRange,
	getSpeedLabel,
	type OnboardingModelsByGroup,
} from "./data-models"
import { getUserTypeSelections, NEW_USER_TYPE, STEP_CONFIG } from "./data-steps"
import { useOnboardingModels } from "./useOnboardingModels"

type OnboardingPage =
	| "user_type"
	| "free_model_selection"
	| "power_model_selection"
	| "byok_provider_config"
	| "account_creation_wait"
	| "legacy_welcome_fallback"

const getOnboardingPage = (step: number, userType: NEW_USER_TYPE): OnboardingPage => {
	if (step === 0) {
		return "user_type"
	}
	if (step === 2) {
		return "account_creation_wait"
	}
	if (userType === NEW_USER_TYPE.POWER) {
		return "power_model_selection"
	}
	if (userType === NEW_USER_TYPE.BYOK) {
		return "byok_provider_config"
	}
	return "free_model_selection"
}

type ModelSelectionProps = {
	userType: NEW_USER_TYPE.FREE | NEW_USER_TYPE.POWER | NEW_USER_TYPE.CLINE_PASS
	selectedModelId: string
	onSelectModel: (modelId: string) => void
	onboardingModels: OnboardingModelsByGroup
	models?: Record<string, ModelInfo>
	searchTerm: string
	setSearchTerm: (term: string) => void
}

function getModelGroupKey(userType: ModelSelectionProps["userType"]): keyof OnboardingModelsByGroup {
	if (userType === NEW_USER_TYPE.CLINE_PASS) {
		return "clinePass"
	}
	return userType === NEW_USER_TYPE.FREE ? "free" : "power"
}

const ModelSelection = ({
	userType,
	selectedModelId,
	onSelectModel,
	models,
	searchTerm,
	setSearchTerm,
	onboardingModels,
}: ModelSelectionProps) => {
	const isClinePass = userType === NEW_USER_TYPE.CLINE_PASS
	const modelGroups = onboardingModels[getModelGroupKey(userType)]
	// ClinePass costs are covered by the subscription, so prices are hidden.
	const hidePrice = isClinePass

	const searchedModels = useMemo(() => {
		if (!models || !searchTerm) {
			return []
		}
		const flattenedModels = modelGroups.flatMap((g) => g.models.map((m) => m.id))
		// Filter out embedding models and already listed models
		const filtered = Object.entries(models).filter(
			([id, _info]) => !id.includes("embedding") && !flattenedModels.includes(id) && id.includes(searchTerm.toLowerCase()),
		)
		return filtered.slice(0, 5) // Return the first 5 models
	}, [models, modelGroups, searchTerm])

	// Model Item Component
	const ModelItem = ({ id, model, isSelected }: { id: string; model: OnboardingModel; isSelected: boolean }) => {
		return (
			<Item
				className={cn("cursor-pointer hover:cursor-pointer", {
					"bg-input-background/80 border border-button-background": isSelected,
				})}
				key={id}
				onClick={() => onSelectModel(id)}
				variant="outline">
				<ItemHeader className="flex flex-col w-full align-baseline">
					<ItemTitle className="flex w-full justify-between">
						<span className="font-semibold">{model.name || id}</span>
						{model.badge ? (
							<Badge className="capitalize" variant="info">
								{model.badge}
							</Badge>
						) : !hidePrice && model.info ? (
							<Badge>{getPriceRange(model.info)}</Badge>
						) : null}
					</ItemTitle>
					{isSelected && model.info && (
						<ItemDescription>
							<span className="text-foreground/70 text-sm">Support: </span>
							<span className="text-foreground text-sm">{getCapabilities(model.info).join(", ")}</span>
						</ItemDescription>
					)}
				</ItemHeader>
				{model.badge && isSelected && (
					<ItemContent className="w-full border-t border-muted-foreground pt-5 text-ellipsis overflow-hidden">
						<div className="flex flex-col gap-3">
							<div className="inline-flex gap-1 [&_svg]:stroke-success [&_svg]:size-3 items-center text-sm">
								<ZapIcon />
								<span>Speed: </span>
								<span className="text-foreground/70">{getSpeedLabel(model.latency)}</span>
							</div>
							{model.info && (
								<div className="flex w-full justify-between">
									<div className="inline-flex gap-1 [&_svg]:stroke-foreground [&_svg]:size-3 items-center text-sm">
										<ListIcon />
										<span>Context: </span>
										<span className="text-foreground/70">{(model?.info.contextWindow || 0) / 1000}k</span>
									</div>
									{!hidePrice && <Badge>{getPriceRange(model.info)}</Badge>}
								</div>
							)}
						</div>
					</ItemContent>
				)}
			</Item>
		)
	}

	// No curated ClinePass models available: show an empty state rather than other models.
	if (isClinePass && modelGroups.length === 0) {
		return (
			<div className="flex w-full max-w-lg flex-col items-center justify-center my-8 px-2 text-center">
				<p className="text-foreground text-sm m-0">No ClinePass models are available right now.</p>
				<p className="text-foreground/70 text-sm mt-1">Please choose another option or try again later.</p>
			</div>
		)
	}

	return (
		<div className="flex flex-col w-full items-center px-2">
			<div className="flex w-full max-w-lg flex-col gap-6 my-4">
				{modelGroups.map((group) => {
					const isClinePassGroup = group.group === CLINEPASS_GROUP
					return (
						<div className="flex flex-col gap-3" key={group.group}>
							<h4
								className={cn(
									"text-sm font-bold text-foreground/70 mb-2",
									isClinePassGroup ? "normal-case" : "uppercase",
								)}>
								{getOnboardingGroupDisplayName(group.group)}
							</h4>
							{group.models.map((model) => (
								<ModelItem id={model.id} isSelected={selectedModelId === model.id} key={model.id} model={model} />
							))}
						</div>
					)
				})}
			</div>

			{/* SEARCH MODEL — hidden for ClinePass, whose selection is constrained to the curated list. */}
			{!isClinePass && (
				<div className="flex w-full max-w-lg flex-col gap-6 my-4 border-t border-muted-foreground">
					<div className="flex flex-col gap-3 mt-6" key="search-results">
						<h4 className="text-sm font-bold text-foreground/70 uppercase mb-2">other options</h4>
						<Input
							autoFocus={false}
							className="focus-visible:border-button-background"
							onChange={(e) => {
								if (!e.target?.value) {
									onSelectModel("")
								}
								setSearchTerm(e.target.value)
							}}
							onClick={() => onSelectModel("")}
							placeholder="Search model..."
							type="search"
							value={searchTerm}
						/>
						<div className="w-full flex flex-col gap-3">
							{searchTerm &&
								searchedModels.map(([id, info]) => {
									const isSelected = selectedModelId === id
									const modelInfo: OpenRouterModelInfo = {
										name: info.name,
										maxTokens: info.maxTokens,
										contextWindow: info.contextWindow,
										supportsImages: info.supportsImages,
										supportsPromptCache: info.supportsPromptCache,
										inputPrice: info.inputPrice,
										outputPrice: info.outputPrice,
										cacheWritesPrice: info.cacheWritesPrice,
										cacheReadsPrice: info.cacheReadsPrice,
										description: info.description,
										supportsGlobalEndpoint: info.supportsGlobalEndpoint,
										thinkingConfig: info.thinkingConfig
											? {
													maxBudget: info.thinkingConfig.maxBudget,
													outputPrice: info.thinkingConfig.outputPrice,
													outputPriceTiers: info.thinkingConfig.outputPriceTiers || [],
												}
											: undefined,
										tiers: info.tiers || [],
									}
									const onboardingModel: OnboardingModel = {
										id,
										name: info.name || id,
										info: modelInfo,
										score: 0,
										latency: 0,
										badge: "",
										group: "",
									}
									return <ModelItem id={id} isSelected={isSelected} key={id} model={onboardingModel} />
								})}
							{searchTerm.length > 0 && searchedModels.length === 0 && (
								<p className="px-1 mt-1 text-sm text-foreground/70">No result found for "{searchTerm}"</p>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

type UserTypeSelectionProps = {
	userType: NEW_USER_TYPE | undefined
	onSelectUserType: (type: NEW_USER_TYPE) => void
	userTypeSelections: ReturnType<typeof getUserTypeSelections>
}

const UserTypeSelectionStep = ({ userType, onSelectUserType, userTypeSelections }: UserTypeSelectionProps) => (
	<div className="flex flex-col w-full items-center">
		<div className="flex w-full max-w-lg flex-col gap-3 my-2">
			{userTypeSelections.map((option) => {
				const isSelected = userType === option.type

				return (
					<Item
						className={cn("cursor-pointer hover:cursor-pointer w-full", {
							"bg-input-background/50 border border-input-foreground/30": isSelected,
						})}
						key={option.type}
						onClick={() => onSelectUserType(option.type)}>
						<ItemMedia className="[&_svg]:stroke-button-background" variant="icon">
							{isSelected ? <CircleCheckIcon className="stroke-1.5" /> : <CircleIcon className="stroke-1" />}
						</ItemMedia>
						<ItemContent className="w-full">
							<ItemTitle>{option.title}</ItemTitle>
							<ItemDescription>{option.description}</ItemDescription>
						</ItemContent>
					</Item>
				)
			})}
		</div>
	</div>
)

type OnboardingStepContentProps = {
	step: number
	userType: NEW_USER_TYPE | undefined
	selectedModelId: string
	onSelectUserType: (type: NEW_USER_TYPE) => void
	onSelectModel: (modelId: string) => void
	searchTerm: string
	setSearchTerm: (term: string) => void
	models?: Record<string, ModelInfo>
	onboardingModels: OnboardingModelsByGroup
	userTypeSelections: ReturnType<typeof getUserTypeSelections>
}

const OnboardingStepContent = ({
	step,
	userType,
	selectedModelId,
	onSelectUserType,
	onSelectModel,
	searchTerm,
	setSearchTerm,
	models,
	onboardingModels,
	userTypeSelections,
}: OnboardingStepContentProps) => {
	if (step === 0) {
		return (
			<UserTypeSelectionStep
				onSelectUserType={onSelectUserType}
				userType={userType}
				userTypeSelections={userTypeSelections}
			/>
		)
	}
	if (step === 2) {
		return null
	}
	if (userType === NEW_USER_TYPE.FREE || userType === NEW_USER_TYPE.POWER || userType === NEW_USER_TYPE.CLINE_PASS) {
		return (
			<ModelSelection
				models={models}
				onboardingModels={onboardingModels}
				onSelectModel={onSelectModel}
				searchTerm={searchTerm}
				selectedModelId={selectedModelId}
				setSearchTerm={setSearchTerm}
				userType={userType}
			/>
		)
	}
	// userType === NEW_USER_TYPE.BYOK
	return <ApiConfigurationSection />
}

const OnboardingViewContent = ({ onboardingModels }: { onboardingModels: OnboardingModelGroup }) => {
	const { handleFieldsChange } = useApiConfigurationHandlers()
	const { openRouterModels, hideSettings, hideAccount, setShowWelcome } = useExtensionState()
	const isClinePassEnabled = useHasFeatureFlag(CLINE_PASS_FEATURE_FLAG)
	const { models: clineModels } = useProviderModels("cline")
	const { commitSelection } = useProviderConfig("cline")
	const loginAttemptIdRef = useRef(0)
	const loginLoadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const viewedPageTelemetryKeysRef = useRef<Set<string>>(new Set())

	const [stepNumber, setStepNumber] = useState(0)
	const [isActionLoading, setIsActionLoading] = useState(false)
	const [userType, setUserType] = useState<NEW_USER_TYPE>(NEW_USER_TYPE.FREE)

	const [selectedModelId, setSelectedModelId] = useState("")
	const [searchTerm, setSearchTerm] = useState("")

	const models = useMemo(() => getClineUIOnboardingGroups(onboardingModels), [onboardingModels])
	// Gate on models too, so a fallback/empty response can't route flagged users into the dead-end empty step.
	const showClinePass = isClinePassEnabled && models.clinePass.length > 0
	const userTypeSelections = useMemo(() => getUserTypeSelections(showClinePass), [showClinePass])
	// ClinePass model IDs (e.g. "cline-pass/glm-5.2") aren't keyed in openRouterModels,
	// so resolve their info via the slug-based lookup used by ClinePassProvider.
	const openRouterModelsByName = useMemo(() => buildModelInfoNameMap(openRouterModels), [openRouterModels])
	const onboardingModelById = useMemo(() => {
		return new Map(onboardingModels.models.map((model) => [model.id, model]))
	}, [onboardingModels])
	const currentPage = useMemo(() => getOnboardingPage(stepNumber, userType), [stepNumber, userType])

	useEffect(() => {
		setSearchTerm("")
		const groupKey = userType === NEW_USER_TYPE.CLINE_PASS ? "clinePass" : userType === NEW_USER_TYPE.POWER ? "power" : "free"
		// ClinePass must stay within its curated list (never fall back to a free/OpenRouter model
		// under the cline-pass provider). Free/Frontier fall back to free if their group is empty.
		const modelGroup = userType === NEW_USER_TYPE.CLINE_PASS ? models[groupKey][0] : (models[groupKey][0] ?? models.free[0])
		const userGroupInitModel = modelGroup?.models[0]
		setSelectedModelId(userGroupInitModel?.id ?? "")
	}, [userType, models])

	useEffect(() => {
		return () => {
			if (loginLoadingTimeoutRef.current) {
				clearTimeout(loginLoadingTimeoutRef.current)
			}
		}
	}, [])

	useEffect(() => {
		const telemetryKey = `${stepNumber}:${currentPage}`
		if (viewedPageTelemetryKeysRef.current.has(telemetryKey)) {
			return
		}
		viewedPageTelemetryKeysRef.current.add(telemetryKey)
		StateServiceClient.captureOnboardingProgress({
			step: stepNumber,
			action: "page_viewed",
			page: currentPage,
			userType: currentPage === "user_type" ? undefined : userType,
			modelSelected: selectedModelId || undefined,
		})
	}, [currentPage, selectedModelId, stepNumber, userType])

	const onUserTypeClick = useCallback((selectedUserType: NEW_USER_TYPE) => {
		setUserType(selectedUserType)
		StateServiceClient.captureOnboardingProgress({
			step: 0,
			action: "option_selected",
			page: "user_type",
			userType: selectedUserType,
		})
	}, [])

	const onModelClick = useCallback(
		(modelSelected: string) => {
			setSelectedModelId(modelSelected)
			if (!modelSelected) {
				return
			}
			StateServiceClient.captureOnboardingProgress({
				step: stepNumber,
				action: "model_selected",
				page: currentPage,
				userType,
				modelSelected,
			})
		},
		[currentPage, stepNumber, userType],
	)

	const finishOnboarding = useCallback(
		async (updateModelId: boolean, step: number) => {
			const modelSelected = (updateModelId && selectedModelId) || undefined
			// Guard: never save a non-ClinePass model id under the cline-pass provider.
			const isClinePassModel = selectedModelId.startsWith("cline-pass/")
			if (modelSelected) {
				if (userType === NEW_USER_TYPE.CLINE_PASS && isClinePassModel) {
					const clinePassModelInfo = resolveClinePassModelInfo(selectedModelId, openRouterModelsByName)
					await handleFieldsChange({
						planModeClinePassModelId: selectedModelId,
						actModeClinePassModelId: selectedModelId,
						planModeClinePassModelInfo: clinePassModelInfo,
						actModeClinePassModelInfo: clinePassModelInfo,
						planModeApiProvider: "cline-pass",
						actModeApiProvider: "cline-pass",
					})
				} else if (userType !== NEW_USER_TYPE.CLINE_PASS) {
					const selectedModelInfo = clineModels[selectedModelId] ??
						onboardingModelById.get(selectedModelId)?.info ?? {
							...openAiModelInfoSafeDefaults,
							name: selectedModelId,
						}

					await Promise.all([
						commitSelection("plan", {
							providerId: "cline",
							modelId: selectedModelId,
							modelInfo: selectedModelInfo,
						}),
						commitSelection("act", {
							providerId: "cline",
							modelId: selectedModelId,
							modelInfo: selectedModelInfo,
						}),
					])

					await handleFieldsChange({
						planModeClineModelId: selectedModelId,
						actModeClineModelId: selectedModelId,
						planModeClineModelInfo: selectedModelInfo,
						actModeClineModelInfo: selectedModelInfo,
						planModeApiProvider: "cline",
						actModeApiProvider: "cline",
					})
				} else {
					// ClinePass selected but the id isn't a cline-pass/ model: skip the write
					// (avoids a bad provider config) and log so the no-op is observable.
					console.error(`Skipped ClinePass provider setup: unexpected model id "${selectedModelId}"`)
				}
			}

			await StateServiceClient.setWelcomeViewCompleted({ value: true }).catch(() => {})
			setShowWelcome(false)
			hideAccount()
			hideSettings()
			StateServiceClient.captureOnboardingProgress({
				step,
				action: "completed",
				page: getOnboardingPage(step, userType),
				userType,
				modelSelected,
				completed: true,
			})
		},
		[
			hideAccount,
			hideSettings,
			handleFieldsChange,
			selectedModelId,
			openRouterModels,
			openRouterModelsByName,
			clineModels,
			onboardingModelById,
			commitSelection,
			setShowWelcome,
			userType,
		],
	)

	const loginAndFinishOnboarding = useCallback(
		async (updateModelId: boolean, step: number) => {
			const loginAttemptId = loginAttemptIdRef.current + 1
			loginAttemptIdRef.current = loginAttemptId

			if (loginLoadingTimeoutRef.current) {
				clearTimeout(loginLoadingTimeoutRef.current)
			}

			setIsActionLoading(true)
			// Allow the user to re-attempt after 10s
			loginLoadingTimeoutRef.current = setTimeout(() => {
				if (loginAttemptIdRef.current === loginAttemptId) {
					setIsActionLoading(false)
				}
			}, 10_000)

			await AccountServiceClient.accountLoginClicked({})
				.catch((error) => {
					console.error("Failed to log in during onboarding:", error)
				})
				.finally(() => {
					if (loginAttemptIdRef.current !== loginAttemptId) {
						return
					}
					if (loginLoadingTimeoutRef.current) {
						clearTimeout(loginLoadingTimeoutRef.current)
						loginLoadingTimeoutRef.current = null
					}
				})

			await finishOnboarding(updateModelId, step)
			setIsActionLoading(false)
		},
		[finishOnboarding],
	)

	const handleFooterAction = useCallback(
		async (action: "signin" | "next" | "back" | "done" | "signup") => {
			const captureNavigation = (telemetryAction: string, destinationStep?: number) => {
				StateServiceClient.captureOnboardingProgress({
					step: stepNumber,
					action: telemetryAction,
					page: currentPage,
					userType,
					modelSelected: selectedModelId || undefined,
					destinationStep,
					destinationPage: destinationStep === undefined ? undefined : getOnboardingPage(destinationStep, userType),
				})
			}

			switch (action) {
				case "signup":
					// ClinePass: record the intent so App opens the subscription page once auth
					// completes (App outlives this view, which unmounts on auth). Login flow unchanged.
					setPendingClinePassSubscribe(userType === NEW_USER_TYPE.CLINE_PASS)
					captureNavigation("signup_clicked", stepNumber + 1)
					setStepNumber(stepNumber + 1)
					await loginAndFinishOnboarding(true, stepNumber + 1)
					break
				case "signin":
					setPendingClinePassSubscribe(false)
					captureNavigation("signin_clicked")
					await loginAndFinishOnboarding(true, stepNumber)
					break
				case "next":
					captureNavigation("continued", stepNumber + 1)
					setStepNumber(stepNumber + 1)
					break
				case "back":
					// Abandon any pending ClinePass subscription redirect when the user goes back.
					setPendingClinePassSubscribe(false)
					captureNavigation("back_clicked", stepNumber - 1)
					setStepNumber(stepNumber - 1)
					break
				case "done":
					await finishOnboarding(false, stepNumber)
					break
			}
		},
		[stepNumber, currentPage, userType, selectedModelId, finishOnboarding, loginAndFinishOnboarding, setShowWelcome],
	)

	const stepDisplayInfo = useMemo(() => {
		const step = stepNumber === 0 || stepNumber === 2 ? STEP_CONFIG[stepNumber] : null
		const title = step ? step.title : userType ? STEP_CONFIG[userType].title : STEP_CONFIG[0].title
		const description = step ? step.description : null
		const buttons = step ? step.buttons : userType ? STEP_CONFIG[userType].buttons : STEP_CONFIG[0].buttons
		return { title, description, buttons }
	}, [stepNumber, userType])

	return (
		<div className="fixed inset-0 p-0 flex flex-col w-full">
			<div className="h-full px-5 xs:mx-10 overflow-auto flex flex-col gap-4 items-center justify-center">
				<ClineLogoWhite className="size-16 flex-shrink-0" />
				<h2 className="text-lg font-semibold p-0 flex-shrink-0">{stepDisplayInfo.title}</h2>
				{stepNumber === 2 && (
					<div className="flex w-full max-w-lg flex-col gap-6 my-4 items-center ">
						<LoaderCircleIcon className="animate-spin" />
					</div>
				)}
				{stepDisplayInfo.description && (
					<p className="text-foreground text-sm text-center m-0 p-0 flex-shrink-0">{stepDisplayInfo.description}</p>
				)}

				<div className="flex-1 w-full flex max-w-lg overflow-y-auto min-h-0">
					<OnboardingStepContent
						models={Object.keys(clineModels).length > 0 ? clineModels : openRouterModels}
						onboardingModels={models}
						onSelectModel={onModelClick}
						onSelectUserType={onUserTypeClick}
						searchTerm={searchTerm}
						selectedModelId={selectedModelId}
						setSearchTerm={setSearchTerm}
						step={stepNumber}
						userType={userType}
						userTypeSelections={userTypeSelections}
					/>
				</div>

				<footer className="flex w-full max-w-lg flex-col gap-3 my-2 px-2 overflow-hidden flex-shrink-0">
					{stepDisplayInfo.buttons.map((btn) => {
						// Block ClinePass signup when no ClinePass model is selected (e.g. empty list).
						const isLoginAction = btn.action === "signin" || btn.action === "signup"
						const showSpinner = isActionLoading && isLoginAction
						const disabled =
							isActionLoading ||
							(btn.action === "signup" && userType === NEW_USER_TYPE.CLINE_PASS && !selectedModelId)
						return (
							<Button
								className={`w-full rounded-xs ${isActionLoading ? "animate-pulse" : ""}`}
								disabled={disabled}
								key={btn.text}
								onClick={() => handleFooterAction(btn.action)}
								variant={btn.variant}>
								{showSpinner && <LoaderCircleIcon className="mr-2 size-4 animate-spin" />}
								{showSpinner ? "Waiting for sign in..." : btn.text}
							</Button>
						)
					})}

					{isActionLoading && stepNumber !== 2 && (
						<div className="items-center justify-center flex text-sm text-foreground/70 text-pretty text-center">
							Complete sign in in your browser. We'll continue automatically once you're done.
						</div>
					)}

					{stepNumber !== 2 && (
						<div className="items-center justify-center flex text-sm text-foreground gap-2 mb-3 text-pretty">
							<AlertCircleIcon className="shrink-0 size-2" /> You can change this later in settings
						</div>
					)}
				</footer>
			</div>
		</div>
	)
}

const OnboardingWelcomeFallback = () => {
	useEffect(() => {
		const page: OnboardingPage = "legacy_welcome_fallback"
		StateServiceClient.captureOnboardingProgress({
			step: 0,
			action: "fallback_welcome_viewed",
			page,
		})
	}, [])

	return <WelcomeView />
}

const OnboardingView = () => {
	const { status, models } = useOnboardingModels()

	if (status === "loading") {
		return (
			<div className="fixed inset-0 flex items-center justify-center">
				<LoaderCircleIcon className="animate-spin" />
			</div>
		)
	}

	if (status === "empty") {
		return <OnboardingWelcomeFallback />
	}

	return <OnboardingViewContent onboardingModels={models} />
}

export default OnboardingView
