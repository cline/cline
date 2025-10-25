import { BooleanRequest } from "@shared/proto/index.cline"
import { AlertCircleIcon, CheckIcon, CircleCheckIcon, CircleIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import ClineLogoWhite from "@/assets/ClineLogoWhite"
import { Button } from "@/components/ui/button"
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { handleSignIn } from "@/context/ClineAuthContext"
import { cn } from "@/lib/utils"
import { StateServiceClient } from "@/services/grpc-client"
import ApiConfigurationSection from "../settings/sections/ApiConfigurationSection"
import { ONBOARDING_MODEL_SELECTIONS } from "./models"

enum USER_TYPE {
	FREE = "free",
	POWER = "power",
	BYOK = "byok",
}

type UserTypeSelection = {
	title: string
	description: string
	type: USER_TYPE
}

const STEP_CONFIG = {
	0: {
		title: "Become a CLINE user!",
		description:
			"Cline is free for individual developers. Pay only for AI inference on a usage basis - no subscriptions, no vendor lock-in. You can change this later!",
		buttons: [
			{ text: "Continue", action: "next", variant: "default" },
			{ text: "Login", action: "auth", variant: "secondary" },
		],
	},
	[USER_TYPE.FREE]: {
		title: "Select a free model",
		buttons: [
			{ text: "Sign Up for Cline", action: "auth", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
	[USER_TYPE.POWER]: {
		title: "Select your model",
		buttons: [
			{ text: "Sign Up for Cline", action: "auth", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
	[USER_TYPE.BYOK]: {
		title: "Configure your provider",
		buttons: [
			{ text: "Ready", action: "done", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
} as const

const USER_TYPE_SELECTIONS: UserTypeSelection[] = [
	{ title: "Absolutely Free", description: "More context of this key feature", type: USER_TYPE.FREE },
	{ title: "Power User", description: "Unlock advanced features and capabilities", type: USER_TYPE.POWER },
	{ title: "I have my own key", description: "Use your own API credentials", type: USER_TYPE.BYOK },
]

type ModelSelectionProps = {
	userType: USER_TYPE.FREE | USER_TYPE.POWER
	selectedModelId: string
	onSelectModel: (modelId: string) => void
}

const ModelSelection = ({ userType, selectedModelId, onSelectModel }: ModelSelectionProps) => {
	const modelGroups = ONBOARDING_MODEL_SELECTIONS[userType === USER_TYPE.FREE ? "free" : "power"]

	const selectedModel = useMemo(() => {
		for (const group of modelGroups) {
			const model = group.models.find((m) => `${group.group}-${m.title}` === selectedModelId)
			if (model) {
				return model
			}
		}
		return modelGroups[0].models[0]
	}, [modelGroups, selectedModelId])

	return (
		<div className="flex flex-col w-full items-center">
			<div className="flex w-full max-w-lg flex-col gap-6 my-4">
				{modelGroups.map((group) => (
					<div className="flex flex-col gap-3" key={group.group}>
						<h4 className="text-sm font-semibold text-foreground/70 uppercase mb-2">{group.group}</h4>
						{group.models.map((model) => {
							const modelId = `${group.group}-${model.title}`
							const isSelected = selectedModelId === modelId

							return (
								<Item
									className={cn("cursor-pointer hover:cursor-pointer", {
										"bg-input-background/30 border border-button-background": isSelected,
									})}
									key={modelId}
									onClick={() => onSelectModel(modelId)}
									variant="outline">
									<ItemContent>
										<ItemTitle className="flex w-full justify-between">
											{model.title}
											<span className="text-button-background uppercase text-xs">{model.badge}</span>
										</ItemTitle>
										<ItemDescription>{model.description}</ItemDescription>
									</ItemContent>
								</Item>
							)
						})}
					</div>
				))}

				<div className="text-sm text-foreground mt-2">
					<div className="uppercase font-semibold">SUPPORTS</div>
					<div className="flex flex-col gap-1 mt-2">
						{selectedModel.capabilities.map((capability) => (
							<div
								className="text-success inline-flex gap-1 [&_svg]:stroke-success [&_svg]:size-3 items-center"
								key={capability}>
								<CheckIcon />
								{capability}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	)
}

type UserTypeSelectionProps = {
	userType: USER_TYPE | undefined
	onSelectUserType: (type: USER_TYPE) => void
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
	userType: USER_TYPE | undefined
	selectedModelId: string
	onSelectUserType: (type: USER_TYPE) => void
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

	if (userType === USER_TYPE.BYOK) {
		return <ApiConfigurationSection />
	}

	if (userType === USER_TYPE.FREE || userType === USER_TYPE.POWER) {
		return <ModelSelection onSelectModel={onSelectModel} selectedModelId={selectedModelId} userType={userType} />
	}

	return null
}

type OnboardingViewProps = {
	showOnboarding: (value: boolean) => void
	onDone: () => void
}

const OnboardingView = ({ showOnboarding, onDone }: OnboardingViewProps) => {
	const [stepNumber, setStepNumber] = useState(0)
	const [userType, setUserType] = useState<USER_TYPE>(USER_TYPE.FREE)
	const [selectedModelId, setSelectedModelId] = useState("")

	useEffect(() => {
		const userGroup = userType === USER_TYPE.POWER ? USER_TYPE.POWER : USER_TYPE.FREE
		const modelGroup = ONBOARDING_MODEL_SELECTIONS[userGroup][0]
		const userGroupInitModel = modelGroup.models[0]
		setSelectedModelId(modelGroup.group + "-" + userGroupInitModel.title)
	}, [userType])

	const finishOnboarding = useCallback(async () => {
		showOnboarding(false)
		onDone()
		await StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true })).catch((err) =>
			console.error("Failed to set welcome view completed:", err),
		)
	}, [])

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
		[handleSignIn, stepNumber],
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
			<div className="h-full px-5 mx-10 overflow-auto flex flex-col gap-7 items-center justify-center">
				<div className="flex justify-center my-5">
					<ClineLogoWhite className="size-16" />
				</div>

				<h2 className="text-lg font-semibold">{stepDisplayInfo.title}</h2>
				<p className="text-foreground text-center max-w-lg m-0 p-0">{stepDisplayInfo.description}</p>

				<div className="flex-1 w-full flex justify-center overflow-y-scroll">
					<OnboardingStepContent
						onSelectModel={setSelectedModelId}
						onSelectUserType={setUserType}
						selectedModelId={selectedModelId}
						step={stepNumber}
						userType={userType}
					/>
				</div>

				<footer className="flex w-full max-w-lg flex-col gap-3 my-2">
					{stepDisplayInfo.buttons.map((btn) => (
						<Button
							className="w-full rounded-xs"
							onClick={() => handleFooterAction(btn.action)}
							size="lg"
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
