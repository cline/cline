import { useTerminalDimensions } from "@opentui/react";
import {
	AutocompleteDropdown,
	type AutocompleteDropdownProps,
	DROPDOWN_MAX_HEIGHT,
} from "../components/autocomplete-dropdown";
import { InputBar, type TextareaHandle } from "../components/input-bar";
import {
	resolveModelContextWindow,
	resolveModelDisplayName,
	StatusBar,
} from "../components/status-bar";
import { TrackedRobot, useMouseTracker } from "../components/tracked-robot";
import { useSession } from "../contexts/session-context";
import { getModeAccent } from "../palette";
import { HOME_VIEW_MAX_WIDTH, type TuiProps } from "../types";

export function HomeView(props: {
	config: TuiProps["config"];
	inputValue: string;
	inputKey: number;
	onSubmit: () => void;
	onContentChange: (text: string) => void;
	onImagePaste: (dataUrl: string) => string;
	repoStatus: {
		branch: string | null;
		diffStats: {
			files: number;
			additions: number;
			deletions: number;
		} | null;
	};
	textareaRef?: React.MutableRefObject<TextareaHandle | null>;
	autocomplete?: AutocompleteDropdownProps;
	onToggleMode: () => void;
}) {
	const {
		config,
		inputValue,
		inputKey,
		onSubmit,
		onContentChange,
		onImagePaste,
		repoStatus,
	} = props;
	const session = useSession();
	const { width } = useTerminalDimensions();
	const mouse = useMouseTracker();

	const accent = getModeAccent(session.uiMode);
	const placeholder =
		session.uiMode === "plan" ? "Plan something..." : "What can I do for you?";
	const modelDisplayName = resolveModelDisplayName(config);
	const contextWindow = resolveModelContextWindow(config);
	const hasAutocomplete =
		props.autocomplete?.mode && props.autocomplete.options.length > 0;

	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			alignItems="center"
			justifyContent="center"
			onMouseMove={mouse.onMouseMove}
		>
			<TrackedRobot cursorX={mouse.cursor.x} cursorY={mouse.cursor.y} />
			<box marginTop={1} marginBottom={1} flexShrink={0}>
				<text>
					<strong>What can I do for you?</strong>
				</text>
			</box>
			<box marginBottom={1} flexShrink={0}>
				<text fg="gray">
					<em>Use / for slash commands and @ for file mentions</em>
				</text>
			</box>

			<box
				flexDirection="column"
				width={Math.min(width, HOME_VIEW_MAX_WIDTH)}
				flexShrink={0}
			>
				<InputBar
					accent={accent}
					placeholder={placeholder}
					initialValue={inputValue}
					inputKey={inputKey}
					onSubmit={onSubmit}
					onContentChange={onContentChange}
					onImagePaste={onImagePaste}
					textareaRef={props.textareaRef}
				/>

				<box flexDirection="column" height={DROPDOWN_MAX_HEIGHT}>
					{hasAutocomplete && props.autocomplete ? (
						<AutocompleteDropdown {...props.autocomplete} accent={accent} />
					) : (
						<StatusBar
							providerId={config.providerId}
							modelId={modelDisplayName}
							totalTokens={session.lastTotalTokens}
							totalCost={session.lastTotalCost}
							contextWindow={contextWindow}
							uiMode={session.uiMode}
							autoApproveAll={session.autoApproveAll}
							workspaceName={
								config.workspaceRoot
									? (config.workspaceRoot.split("/").pop() ?? "")
									: ""
							}
							gitBranch={repoStatus.branch}
							gitDiffStats={repoStatus.diffStats}
							onToggleMode={props.onToggleMode}
							variant="home"
						/>
					)}
				</box>
			</box>
		</box>
	);
}
