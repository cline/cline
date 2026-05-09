import { useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
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
import { useTerminalBackground } from "../hooks/use-terminal-background";
import {
	getDefaultForeground,
	getModeAccent,
	getModeInputBackground,
	getModeInputForeground,
	getModeInputPlaceholder,
} from "../palette";
import { HOME_VIEW_MAX_WIDTH, type TuiProps } from "../types";

export function HomeView(props: {
	config: TuiProps["config"];
	inputValue: string;
	inputKey: number;
	onSubmit: () => void;
	onContentChange: (text: string) => void;
	onImagePaste: (dataUrl: string) => string;
	onLargeTextPaste: (text: string) => string;
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
		onLargeTextPaste,
		repoStatus,
	} = props;
	const session = useSession();
	const { width, height } = useTerminalDimensions();
	const mouse = useMouseTracker();
	const [inputCursor, setInputCursor] = useState<{
		visualCol: number;
		visualRow: number;
	} | null>(null);

	const terminalBg = useTerminalBackground();
	const defaultFg = getDefaultForeground(terminalBg);
	const accent = getModeAccent(session.uiMode);
	const inputBackground = getModeInputBackground(session.uiMode, terminalBg);
	const inputForeground = getModeInputForeground(session.uiMode, terminalBg);
	const inputPlaceholder = getModeInputPlaceholder(session.uiMode, terminalBg);
	const placeholder =
		session.uiMode === "plan" ? "Plan something..." : "What can I do for you?";
	const modelDisplayName = resolveModelDisplayName(config);
	const contextWindow = resolveModelContextWindow(config);
	const hasAutocomplete =
		props.autocomplete?.mode && props.autocomplete.options.length > 0;
	const contentWidth = Math.min(width, HOME_VIEW_MAX_WIDTH);
	const hasTypedInput = inputValue.trim().length > 0;
	const inputStartX = Math.floor((width - contentWidth) / 2) + 4;
	const clamp = (value: number, min: number, max: number) =>
		Math.max(min, Math.min(max, value));
	const trackedCursorX = hasTypedInput
		? clamp(inputStartX + (inputCursor?.visualCol ?? 0), 0, width)
		: mouse.cursor.x;
	const trackedCursorY = hasTypedInput
		? clamp(height - 2 + (inputCursor?.visualRow ?? 0), 0, height)
		: mouse.cursor.y;

	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			alignItems="center"
			justifyContent="center"
			onMouseMove={mouse.onMouseMove}
		>
			<TrackedRobot cursorX={trackedCursorX} cursorY={trackedCursorY} />
			<box marginTop={1} marginBottom={1} flexShrink={0}>
				<text fg={defaultFg}>
					<strong>What can I do for you?</strong>
				</text>
			</box>
			<box marginBottom={1} flexShrink={0}>
				<text fg="gray">
					<em>Use / for slash commands and @ for file mentions</em>
				</text>
			</box>

			<box flexDirection="column" width={contentWidth} flexShrink={0}>
				<InputBar
					accent={accent}
					inputBackground={inputBackground}
					inputForeground={inputForeground}
					inputPlaceholder={inputPlaceholder}
					placeholder={placeholder}
					initialValue={inputValue}
					inputKey={inputKey}
					onSubmit={onSubmit}
					onContentChange={onContentChange}
					onVisualCursorChange={setInputCursor}
					onImagePaste={onImagePaste}
					onLargeTextPaste={onLargeTextPaste}
					textareaRef={props.textareaRef}
				/>

				<box flexDirection="column" height={DROPDOWN_MAX_HEIGHT + 1}>
					{hasAutocomplete && props.autocomplete ? (
						<AutocompleteDropdown
							{...props.autocomplete}
							accent={accent}
							containerWidth={Math.min(width, HOME_VIEW_MAX_WIDTH)}
						/>
					) : (
						<box marginTop={1}>
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
						</box>
					)}
				</box>
			</box>
		</box>
	);
}
