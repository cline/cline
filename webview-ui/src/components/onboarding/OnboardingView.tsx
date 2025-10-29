import { BooleanRequest } from "@shared/proto/index.cline"
import { AlertCircleIcon, CircleCheckIcon, CircleIcon, ListIcon, StarIcon, ZapIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import ClineLogoWhite from "@/assets/ClineLogoWhite"
import { Button } from "@/components/ui/button"
import { Item, ItemContent, ItemDescription, ItemHeader, ItemMedia, ItemTitle } from "@/components/ui/item"
import { handleSignIn } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { StateServiceClient } from "@/services/grpc-client"
import ApiConfigurationSection from "../settings/sections/ApiConfigurationSection"
import { useApiConfigurationHandlers } from "../settings/utils/useApiConfigurationHandlers"
import { getCapabilities, getOverviewLabel, getPriceRange, ONBOARDING_MODEL_SELECTIONS } from "./data-models"
import { NEW_USER_TYPE, STEP_CONFIG, USER_TYPE_SELECTIONS } from "./data-steps"

type ModelSelectionProps = {
	userType: NEW_USER_TYPE.FREE | NEW_USER_TYPE.POWER
	selectedModelId: string
	onSelectModel: (modelId: string) => void
}

const ModelSelection = ({ userType, selectedModelId, onSelectModel }: ModelSelectionProps) => {
	const modelGroups = ONBOARDING_MODEL_SELECTIONS[userType === NEW_USER_TYPE.FREE ? "free" : "power"]

	return (
		<div className="flex flex-col w-full items-center px-2">
			<div className="flex w-full max-w-lg flex-col gap-6 my-4">
				{modelGroups.map((group) => (
					<div className="flex flex-col gap-3" key={group.group}>
						<h4 className="text-sm font-semibold text-foreground/70 uppercase mb-2">{group.group}</h4>
						{group.models.map((model) => {
							const isSelected = selectedModelId === model.id

							return (
								<div className="w-full">
									<Item
										className={cn("cursor-pointer hover:cursor-pointer", {
											"bg-input-background/30 border border-button-background": isSelected,
										})}
										key={model.id}
										onClick={() => onSelectModel(model.id)}
										variant="outline">
										<ItemHeader className="flex flex-col w-full align-baseline">
											<ItemTitle className="flex w-full justify-between">
												{model.name}
												<span className="text-button-background uppercase text-xs">{model.badge}</span>
											</ItemTitle>
											{isSelected && (
												<ItemDescription>
													<span className="text-foreground/70">Support: </span>{" "}
													<span className="text-foreground">
														{getCapabilities(model.modelInfo).join(", ")}
													</span>
												</ItemDescription>
											)}
										</ItemHeader>
										{isSelected && (
											<ItemContent className="w-full border-t border-muted-foreground pt-5 text-ellipsis overflow-hidden">
												<div className="flex flex-col gap-3">
													<div className="inline-flex gap-1 [&_svg]:stroke-warning [&_svg]:size-3 items-center">
														<StarIcon />
														<span>Model Overview:</span>
														<span className="text-foreground/70">{`${getOverviewLabel(model.score)}`}</span>
													</div>
													<div className="inline-flex gap-1 [&_svg]:stroke-success [&_svg]:size-3 items-center">
														<ZapIcon />
														<span>Speed:</span>{" "}
														<span className="text-foreground/70">{model.speed}</span>
													</div>
													<div className="flex w-full justify-between">
														<div className="inline-flex gap-1 [&_svg]:stroke-foreground [&_svg]:size-3 items-center">
															<ListIcon />
															<span>Context:</span>{" "}
															<span className="text-foreground/70">
																{(model.modelInfo?.contextWindow || 0) / 1000}k
															</span>
														</div>
														<span className="bg-button-secondary-background text-button-secondary-foreground/80 text-xs px-2 rounded-lg">
															{getPriceRange(model.modelInfo)}
														</span>
													</div>
												</div>
											</ItemContent>
										)}
									</Item>
								</div>
							)
						})}
					</div>
				))}
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
}

const OnboardingStepContent = ({
	step,
	userType,
	selectedModelId,
	onSelectUserType,
	onSelectModel,
}: OnboardingStepContentProps) => {
	if (step === 0) {
		return <UserTypeSelectionStep onSelectUserType={onSelectUserType} userType={userType} />
	}

	if (userType === NEW_USER_TYPE.BYOK) {
		return <ApiConfigurationSection />
	}

	if (userType === NEW_USER_TYPE.FREE || userType === NEW_USER_TYPE.POWER) {
		return <ModelSelection onSelectModel={onSelectModel} selectedModelId={selectedModelId} userType={userType} />
	}

	return null
}

const OnboardingView = () => {
	const { handleFieldsChange } = useApiConfigurationHandlers()
	const { openRouterModels, hideSettings, hideAccount, setShowWelcome } = useExtensionState()

	const [stepNumber, setStepNumber] = useState(0)
	const [userType, setUserType] = useState<NEW_USER_TYPE>(NEW_USER_TYPE.FREE)
	const [selectedModelId, setSelectedModelId] = useState("")

	useEffect(() => {
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
	}, [handleFieldsChange, selectedModelId, openRouterModels])

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
		[handleSignIn, stepNumber, finishOnboarding],
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
			<div className="h-full px-5 mx-10 overflow-auto flex flex-col gap-7 items-center justify-center mt-10">
				<ClineLogoWhite className="size-16" />

				<h2 className="text-lg font-semibold">{stepDisplayInfo.title}</h2>
				{stepDisplayInfo.description && (
					<p className="text-foreground text-sm text-center max-w-lg m-0 p-0">{stepDisplayInfo.description}</p>
				)}

				<div className="flex-1 w-full flex overflow-y-scroll">
					<OnboardingStepContent
						onSelectModel={setSelectedModelId}
						onSelectUserType={setUserType}
						selectedModelId={selectedModelId}
						step={stepNumber}
						userType={userType}
					/>
				</div>

				<footer className="flex w-full max-w-lg flex-col gap-3 my-2 px-2">
					{stepDisplayInfo.buttons.map((btn) => (
						<Button
							className="w-full rounded-xs"
							onClick={() => handleFooterAction(btn.action)}
							variant={btn.variant}>
							{btn.text}
						</Button>
					))}

					<div className="items-center justify-center flex text-sm text-muted-foreground gap-2 mb-3">
						<AlertCircleIcon className="size-2" /> You can change this later in settings
					</div>
				</footer>
			</div>
		</div>
	)
}

export default OnboardingView
