import "opentui-spinner/react";
import type { ReactNode } from "react";
import {
	ClineModelPicker,
	type ClineModelPickerEntry,
} from "../../components/model-selector/cline-model-picker";
import {
	type SearchableItem,
	SearchableList,
	type SearchableListState,
} from "../../components/searchable-list";
import {
	TrackedRobot,
	type useMouseTracker,
} from "../../components/tracked-robot";
import { palette } from "../../palette";
import { MAIN_MENU, THINKING_LEVELS } from "./model";

type MouseTrackerState = ReturnType<typeof useMouseTracker>;

interface OnboardingFrameProps {
	children: ReactNode;
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
}

function OnboardingFrame({
	children,
	compact,
	contentWidth,
	mouse,
}: OnboardingFrameProps) {
	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			justifyContent="center"
			alignItems="center"
			onMouseMove={mouse.onMouseMove}
		>
			{!compact && (
				<TrackedRobot cursorX={mouse.cursor.x} cursorY={mouse.cursor.y} />
			)}
			<box
				flexDirection="column"
				width={contentWidth}
				marginTop={compact ? 0 : 1}
				gap={1}
			>
				{children}
			</box>
		</box>
	);
}

export function OnboardingDoneScreen(props: { mouse: MouseTrackerState }) {
	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			justifyContent="center"
			alignItems="center"
			onMouseMove={props.mouse.onMouseMove}
		>
			<text fg={palette.success}>{"\u2714"} You're all set!</text>
		</box>
	);
}

export function OnboardingOAuthPendingScreen(props: {
	authError: string;
	authStatus: string;
	authUrl: string;
	compact: boolean;
	contentWidth: number;
	label: string;
	mouse: MouseTrackerState;
	oauthProvider: string;
}) {
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<box flexDirection="column" alignItems="center" gap={1}>
				<text>Signing in with {props.label}</text>

				{!props.authError && (
					<box flexDirection="row" gap={1} justifyContent="center">
						<spinner name="dots" color={palette.act} />
						<text fg="gray">{props.authStatus}</text>
					</box>
				)}

				{props.authError && (
					<box flexDirection="column" alignItems="center" gap={1}>
						<text fg="red">{props.authError}</text>
						<text fg="gray">Esc to go back</text>
					</box>
				)}

				{props.authUrl && !props.authError && (
					<box
						flexDirection="column"
						border
						borderStyle="rounded"
						borderColor="#333333"
						paddingX={2}
						paddingY={1}
						width={props.contentWidth}
					>
						<text fg="gray">If the browser didn't open:</text>
						<text fg={palette.act} marginTop={1} selectable>
							{props.authUrl}
						</text>
					</box>
				)}

				{props.oauthProvider === "cline" && !props.authError && (
					<text fg="gray">
						Can't open a browser? <em>Press d to use a device code instead</em>
					</text>
				)}

				<text fg="gray">
					<em>Esc to cancel, Ctrl+C to exit</em>
				</text>
			</box>
		</OnboardingFrame>
	);
}

export function OnboardingDeviceCodeScreen(props: {
	compact: boolean;
	contentWidth: number;
	deviceError: string;
	deviceStatus: string;
	deviceUserCode: string;
	deviceVerifyUrl: string;
	label: string;
	mouse: MouseTrackerState;
}) {
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<box flexDirection="column" alignItems="center" gap={1}>
				<text>Signing in with {props.label}</text>

				{!props.deviceUserCode && !props.deviceError && (
					<box flexDirection="row" gap={1} justifyContent="center">
						<spinner name="dots" color={palette.act} />
						<text fg="gray">{props.deviceStatus}</text>
					</box>
				)}

				{props.deviceError && (
					<box flexDirection="column" alignItems="center" gap={1}>
						<text fg="red">{props.deviceError}</text>
						<text fg="gray">Esc to go back</text>
					</box>
				)}

				{props.deviceUserCode && !props.deviceError && (
					<box
						flexDirection="column"
						border
						borderStyle="rounded"
						borderColor={palette.act}
						paddingX={2}
						paddingY={1}
						width={props.contentWidth}
						alignItems="center"
						gap={1}
					>
						<text fg="gray">Your code:</text>
						<text fg="white" selectable>
							<strong>{props.deviceUserCode}</strong>
						</text>
						<text fg="gray" marginTop={1}>
							Visit this URL and enter the code above:
						</text>
						<text fg={palette.act} selectable>
							{props.deviceVerifyUrl}
						</text>
					</box>
				)}

				{props.deviceUserCode && !props.deviceError && (
					<box flexDirection="row" gap={1} justifyContent="center">
						<spinner name="dots" color={palette.act} />
						<text fg="gray">Waiting for sign-in...</text>
					</box>
				)}

				<text fg="gray">
					<em>Esc to cancel, Ctrl+C to exit</em>
				</text>
			</box>
		</OnboardingFrame>
	);
}

export function OnboardingApiKeyScreen(props: {
	activeProviderName: string;
	apiKeyError: string;
	apiKeyValue: string;
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
	onApiKeyInput: (value: string) => void;
	onSubmit: () => void;
}) {
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<box flexDirection="column" gap={1} alignItems="center">
				<text>{props.activeProviderName} API Key</text>

				<box
					border
					borderStyle="rounded"
					borderColor={palette.act}
					paddingX={1}
					width={props.contentWidth}
				>
					<input
						value={props.apiKeyValue}
						onInput={props.onApiKeyInput}
						onSubmit={props.onSubmit}
						placeholder="Paste your API key here..."
						focused
						flexGrow={1}
					/>
				</box>

				{props.apiKeyError && <text fg="red">{props.apiKeyError}</text>}

				<text fg="gray">
					<em>Enter to save, Esc to go back, Ctrl+C to exit</em>
				</text>
			</box>
		</OnboardingFrame>
	);
}

export function OnboardingProviderPickerScreen(props: {
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
	providerList: SearchableListState;
	providersLoading: boolean;
}) {
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<text paddingX={1}>Choose a provider</text>

			{props.providersLoading ? (
				<box flexDirection="row" gap={1} paddingX={1}>
					<spinner name="dots" color="gray" />
					<text fg="gray">Loading providers...</text>
				</box>
			) : (
				<SearchableList
					items={props.providerList.filtered}
					selected={props.providerList.safeSelected}
					onSearchChange={props.providerList.setSearch}
					placeholder="Search providers..."
					emptyText="No providers match"
				/>
			)}

			<text fg="gray" paddingX={1}>
				<em>
					Type to search, ↑/↓ navigate, Enter to select, Esc to go back, Ctrl+C
					to exit
				</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingClineModelScreen(props: {
	clineEntries: ClineModelPickerEntry[];
	clineKnownModels: Record<string, unknown> | undefined;
	clineModelSelected: number;
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
	recommendedLoading: boolean;
}) {
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<text paddingX={1}>
				<strong>Choose a model</strong>
			</text>
			<text fg="gray" paddingX={1}>
				You can change this anytime
			</text>

			<ClineModelPicker
				entries={props.clineEntries}
				selected={props.clineModelSelected}
				loading={props.recommendedLoading}
				knownModels={props.clineKnownModels}
			/>

			<text fg="gray" paddingX={1}>
				<em>↑/↓ navigate, Enter to select, Esc to go back, Ctrl+C to exit</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingModelPickerScreen(props: {
	activeProviderName: string;
	compact: boolean;
	contentWidth: number;
	modelItems: SearchableItem[];
	modelList: SearchableListState;
	modelsLoading: boolean;
	mouse: MouseTrackerState;
}) {
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<text paddingX={1}>
				<strong>Choose a model for {props.activeProviderName}</strong>
			</text>
			<text fg="gray" paddingX={1}>
				You can change this anytime
			</text>

			{props.modelsLoading ? (
				<box flexDirection="row" gap={1} paddingX={1}>
					<spinner name="dots" color="gray" />
					<text fg="gray">Loading models...</text>
				</box>
			) : props.modelItems.length === 0 ? (
				<text fg="gray" paddingX={1}>
					No models found for this provider
				</text>
			) : (
				<SearchableList
					items={props.modelList.filtered}
					selected={props.modelList.safeSelected}
					onSearchChange={props.modelList.setSearch}
					placeholder="Search models..."
					emptyText="No models match"
				/>
			)}

			<text fg="gray" paddingX={1}>
				<em>
					Type to search, ↑/↓ navigate, Enter to select, Esc to go back, Ctrl+C
					to exit
				</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingThinkingLevelScreen(props: {
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
	selectedModelName: string;
	thinkingSelected: number;
}) {
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<text paddingX={1}>Thinking level for {props.selectedModelName}</text>
			<text fg="gray" paddingX={1}>
				Extended thinking lets the model reason through complex problems
			</text>

			<box flexDirection="column">
				{THINKING_LEVELS.map((level, i) => {
					const isSel = i === props.thinkingSelected;
					return (
						<box
							key={level.value}
							paddingX={1}
							flexDirection="row"
							gap={1}
							backgroundColor={isSel ? palette.selection : undefined}
							height={1}
						>
							<text
								fg={isSel ? palette.textOnSelection : "gray"}
								flexShrink={0}
							>
								{isSel ? "\u276f" : " "}
							</text>
							<text fg={isSel ? palette.textOnSelection : undefined}>
								{level.label}
							</text>
							<text fg={isSel ? palette.textOnSelection : "gray"}>
								{level.desc}
							</text>
						</box>
					);
				})}
			</box>

			<text fg="gray" paddingX={1}>
				<em>↑/↓ navigate, Enter to select, Esc to go back, Ctrl+C to exit</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingMainMenuScreen(props: {
	contentWidth: number;
	menuSelected: number;
	mouse: MouseTrackerState;
}) {
	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			justifyContent="center"
			alignItems="center"
			onMouseMove={props.mouse.onMouseMove}
		>
			<TrackedRobot
				cursorX={props.mouse.cursor.x}
				cursorY={props.mouse.cursor.y}
			/>

			<box
				flexDirection="column"
				width={props.contentWidth}
				alignItems="center"
				marginTop={1}
			>
				<text>
					<strong>Welcome to Cline</strong>
				</text>
				<text fg="gray" marginTop={1}>
					Connect a model provider to get started.
				</text>
			</box>

			<box
				flexDirection="column"
				width={props.contentWidth}
				marginTop={1}
				gap={0}
			>
				{MAIN_MENU.map((option, i) => {
					const isSel = i === props.menuSelected;
					return (
						<box
							key={option.value}
							flexDirection="row"
							border
							borderStyle="rounded"
							borderColor={isSel ? palette.act : "#333333"}
							paddingX={1}
							gap={1}
							alignItems="center"
						>
							<text fg={isSel ? palette.act : "#555555"} flexShrink={0}>
								{option.icon}
							</text>
							<box flexDirection="column" flexGrow={1}>
								<text fg={isSel ? "white" : "gray"}>{option.label}</text>
								<text fg={isSel ? "gray" : "#555555"}>{option.detail}</text>
							</box>
							{isSel && (
								<text fg={palette.act} flexShrink={0}>
									{"\u2192"}
								</text>
							)}
						</box>
					);
				})}
			</box>

			<text fg="gray" marginTop={1}>
				<em>↑/↓ navigate, Enter to select, Ctrl+C to exit</em>
			</text>
		</box>
	);
}
