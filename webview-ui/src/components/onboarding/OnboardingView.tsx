import type { ModelInfo } from "@shared/api"
import { BooleanRequest } from "@shared/proto/index.cline"
import { AlertCircleIcon, CircleCheckIcon, CircleIcon, ListIcon, StarIcon, ZapIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import ClineLogoWhite from "@/assets/ClineLogoWhite"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Item, ItemContent, ItemDescription, ItemHeader, ItemMedia, ItemTitle } from "@/components/ui/item"
import { handleSignIn } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { StateServiceClient } from "@/services/grpc-client"
import ApiConfigurationSection from "../settings/sections/ApiConfigurationSection"
import { useApiConfigurationHandlers } from "../settings/utils/useApiConfigurationHandlers"
import {
	getCapabilities,
	getOverviewLabel,
	getPriceRange,
	ONBOARDING_MODEL_SELECTIONS,
	type OnboardingModelOption,
} from "./data-models"
import { NEW_USER_TYPE, STEP_CONFIG, USER_TYPE_SELECTIONS } from "./data-steps"

type ModelSelectionProps = {
	userType: NEW_USER_TYPE.FREE | NEW_USER_TYPE.POWER
	selectedModelId: string
	onSelectModel: (modelId: string) => void
	models?: Record<string, ModelInfo>
	searchTerm: string
	setSearchTerm: (term: string) => void
}

const ModelSelection = ({ userType, selectedModelId, onSelectModel, models, searchTerm, setSearchTerm }: ModelSelectionProps) => {
	const modelGroups = ONBOARDING_MODEL_SELECTIONS[userType === NEW_USER_TYPE.FREE ? "free" : "power"]

	const searchedModels = useMemo(() => {
		if (!models || !searchTerm) {
			return []
		}
		const flattenedModels = modelGroups.flatMap((g) => g.models.map((m) => m.id))
		// Filter out embedding models and already listed models
		const filtered = Object.entries(models).filter(
			([id, _info]) => !id.includes("embedding") && !flattenedModels.includes(id) && id.includes(searchTerm.toLowerCase()),
		)
		return filtered.slice(0, 4) // Return the first 5 models
	}, [models, modelGroups, searchTerm])

	// Model Item Component
	const ModelItem = ({ id, model, isSelected }: { id: string; model: OnboardingModelOption; isSelected: boolean }) => {
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
						{model.badge ? <Badge variant="info">{model.badge}</Badge> : <Badge>{getPriceRange(model)}</Badge>}
					</ItemTitle>
					{isSelected && (
						<ItemDescription>
							<span className="text-foreground/70 text-sm">Support: </span>
							<span className="text-foreground text-sm">{getCapabilities(model).join(", ")}</span>
						</ItemDescription>
					)}
				</ItemHeader>
				{model.badge && isSelected && (
					<ItemContent className="w-full border-t border-muted-foreground pt-5 text-ellipsis overflow-hidden">
						<div className="flex flex-col gap-3">
							{model.score && (
								<div className="inline-flex gap-1 [&_svg]:stroke-warning [&_svg]:size-3 items-center text-sm">
									<StarIcon />
									<span>Model Overview: </span>
									<span className="text-foreground/70">{model.score}%</span>
									<span className="text-foreground/70 hidden xs:block">{getOverviewLabel(model.score)}</span>
								</div>
							)}
							<div className="inline-flex gap-1 [&_svg]:stroke-success [&_svg]:size-3 items-center text-sm">
								<ZapIcon />
								<span>Speed: </span>
								<span className="text-foreground/70">{model.speed}</span>
							</div>
							<div className="flex w-full justify-between">
								<div className="inline-flex gap-1 [&_svg]:stroke-foreground [&_svg]:size-3 items-center text-sm">
									<ListIcon />
									<span>Context: </span>
									<span className="text-foreground/70">{(model?.contextWindow || 0) / 1000}k</span>
								</div>
								<Badge>{getPriceRange(model)}</Badge>
							</div>
						</div>
					</ItemContent>
				)}
			</Item>
		)
	}

	return (
		<div className="flex flex-col w-full items-center px-2">
			<div className="flex w-full max-w-lg flex-col gap-6 my-4">
				{modelGroups.map((group) => (
					<div className="flex flex-col gap-3" key={group.group}>
						<h4 className="text-sm font-bold text-foreground/70 uppercase mb-2">{group.group}</h4>
						{group.models.map((model) => (
							<ModelItem id={model.id} isSelected={selectedModelId === model.id} key={model.id} model={model} />
						))}
					</div>
				))}
			</div>

			{/* SEARCH MODEL */}
			<div className="flex w-full max-w-lg flex-col gap-6 my-4 border-t border-muted-foreground">
				<div className="flex flex-col gap-3 mt-6" key="search-results">
					<h4 className="text-sm font-bold text-foreground/70 uppercase mb-2">other options</h4>
					<Input
						autoFocus={false}
						className="focus-visible:border-button-background"
						onChange={(e) => setSearchTerm(e.target?.value)}
						onClick={() => onSelectModel("")}
						placeholder="e.g. 'opus', '4o', 'gemini-2.5' etc."
						type="search"
						value={searchTerm}
					/>
					<div className="w-full flex flex-col gap-3">
						{searchTerm &&
							searchedModels.map(([id, info]) => {
								const isSelected = selectedModelId === id
								return (
									<ModelItem
										id={id}
										isSelected={isSelected}
										key={id}
										model={{ id, name: info.name, ...info }}
									/>
								)
							})}
						{searchTerm && searchedModels.length === 0 && (
							<p className="px-1 mt-1 text-sm text-foreground/70">No result found for "{searchTerm}"</p>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

type UserTypeSelectionProps = {
	userType: NEW_USER_TYPE | undefined
	onSelectUserType: (type: NEW_USER_TYPE) => void
}

const UserTypeSelectionStep = ({ userType, onSelectUserType }: UserTypeSelectionProps) => (
	<div className="flex flex-col w-full items-center">
		<div className="flex w-full max-w-lg flex-col gap-6 my-4">
			<h3 className="text-base text-left self-start font-semibold">LETS GET STARTED</h3>
			{USER_TYPE_SELECTIONS.map((option) => {
				const isSelected = userType === option.type

				return (
					<Item
						className={cn("cursor-pointer hover:cursor-pointer w-full", {
							"bg-input-background/70 border border-input-foreground/10": isSelected,
						})}
						key={option.type}
						onClick={() => onSelectUserType(option.type)}>
						<ItemMedia className="[&_svg]:stroke-button-background" variant="icon">
							{isSelected ? <CircleCheckIcon strokeWidth={1.5} /> : <CircleIcon strokeWidth={1.5} />}
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
}: OnboardingStepContentProps) => {
	if (step === 0) {
		return <UserTypeSelectionStep onSelectUserType={onSelectUserType} userType={userType} />
	}

	if (userType === NEW_USER_TYPE.BYOK) {
		return <ApiConfigurationSection />
	}

	if (userType === NEW_USER_TYPE.FREE || userType === NEW_USER_TYPE.POWER) {
		return (
			<ModelSelection
				models={models}
				onSelectModel={onSelectModel}
				searchTerm={searchTerm}
				selectedModelId={selectedModelId}
				setSearchTerm={setSearchTerm}
				userType={userType}
			/>
		)
	}

	return null
}

const OnboardingView = () => {
	const { handleFieldsChange } = useApiConfigurationHandlers()
	const { openRouterModels, hideSettings, hideAccount, setShowWelcome } = useExtensionState()

	const [stepNumber, setStepNumber] = useState(0)
	const [userType, setUserType] = useState<NEW_USER_TYPE>(NEW_USER_TYPE.FREE)

	const [selectedModelId, setSelectedModelId] = useState("")
	const [searchTerm, setSearchTerm] = useState("")

	useEffect(() => {
		setSearchTerm("")
		const userGroup = userType === NEW_USER_TYPE.POWER ? NEW_USER_TYPE.POWER : NEW_USER_TYPE.FREE
		const modelGroup = ONBOARDING_MODEL_SELECTIONS[userGroup][0]
		const userGroupInitModel = modelGroup.models[0]
		setSelectedModelId(userGroupInitModel.id)
	}, [userType])

	const finishOnboarding = useCallback(async () => {
		if (selectedModelId) {
			handleFieldsChange({
				planModeOpenRouterModelId: selectedModelId,
				actModeOpenRouterModelId: selectedModelId,
				planModeOpenRouterModelInfo: openRouterModels[selectedModelId],
				actModeOpenRouterModelInfo: openRouterModels[selectedModelId],
				planModeApiProvider: "cline",
				actModeApiProvider: "cline",
			})
		}
		hideAccount()
		hideSettings()
		setShowWelcome(false)
		StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true })).catch((err) => console.error(err))
	}, [hideAccount, hideSettings, setShowWelcome, handleFieldsChange, selectedModelId, openRouterModels])

	const handleFooterAction = useCallback(
		(action: "auth" | "next" | "back" | "done") => {
			switch (action) {
				case "auth":
					handleSignIn()
					finishOnboarding()
					break
				case "next":
					setStepNumber(stepNumber + 1)
					break
				case "back":
					setStepNumber(stepNumber - 1)
					break
				case "done":
					finishOnboarding()
					break
			}
		},
		[stepNumber, finishOnboarding],
	)

	const stepDisplayInfo = useMemo(() => {
		const title = stepNumber === 0 ? STEP_CONFIG[0].title : userType ? STEP_CONFIG[userType].title : STEP_CONFIG[0].title
		const description = stepNumber === 0 ? STEP_CONFIG[0].description : null
		const buttons =
			stepNumber === 0 ? STEP_CONFIG[0].buttons : userType ? STEP_CONFIG[userType].buttons : STEP_CONFIG[0].buttons
		return { title, description, buttons }
	}, [stepNumber, userType])

	return (
		<div className="fixed inset-0 p-0 flex flex-col">
			<div className="h-full px-5 xs:mx-10 overflow-auto flex flex-col gap-7 items-center justify-center mt-10">
				<ClineLogoWhite className="size-16" />

				<h2 className="text-lg font-semibold">{stepDisplayInfo.title}</h2>
				{stepDisplayInfo.description && (
					<p className="text-foreground text-sm text-center max-w-lg m-0 p-0">{stepDisplayInfo.description}</p>
				)}

				<div className="flex-1 w-full flex overflow-y-scroll">
					<OnboardingStepContent
						models={openRouterModels}
						onSelectModel={setSelectedModelId}
						onSelectUserType={setUserType}
						searchTerm={searchTerm}
						selectedModelId={selectedModelId}
						setSearchTerm={setSearchTerm}
						step={stepNumber}
						userType={userType}
					/>
				</div>

				<footer className="flex w-full max-w-lg flex-col gap-3 my-2 px-2 overflow-hidden">
					{stepDisplayInfo.buttons.map((btn) => (
						<Button
							className="w-full rounded-xs"
							onClick={() => handleFooterAction(btn.action)}
							variant={btn.variant}>
							{btn.text}
						</Button>
					))}

					<div className="items-center justify-center flex text-sm text-foreground gap-2 mb-3 text-pretty">
						<AlertCircleIcon className="shrink-0 size-2" /> You can change this later in settings
					</div>
				</footer>
			</div>
		</div>
	)
}

export default OnboardingView
