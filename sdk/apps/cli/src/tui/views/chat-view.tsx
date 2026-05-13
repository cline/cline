import {
	AutocompleteDropdown,
	type AutocompleteDropdownProps,
} from "../components/autocomplete-dropdown";
import {
	ChatMessageList,
	type TranscriptScrollHandle,
} from "../components/chat-message-list";
import { InputBar, type TextareaHandle } from "../components/input-bar";
import { QueuedPrompts } from "../components/queued-prompts";
import {
	resolveModelDisplayName,
	resolveModelMaxInputTokens,
	StatusBar,
} from "../components/status-bar";
import { useSession } from "../contexts/session-context";
import { useTerminalBackground } from "../hooks/use-terminal-background";
import {
	getModeAccent,
	getModeInputBackground,
	getModeInputForeground,
	getModeInputPlaceholder,
} from "../palette";
import type { QueuedPromptItem, TuiProps } from "../types";

export function ChatView(props: {
	config: TuiProps["config"];
	inputValue: string;
	inputKey: number;
	onSubmit: () => void;
	onContentChange: (text: string) => void;
	onImagePaste: (dataUrl: string) => string;
	onLargeTextPaste: (text: string) => string;
	onInputFocusRequest?: () => void;
	repoStatus: {
		branch: string | null;
		diffStats: {
			files: number;
			additions: number;
			deletions: number;
		} | null;
	};
	textareaRef?: React.MutableRefObject<TextareaHandle | null>;
	transcriptScrollRef?: React.Ref<TranscriptScrollHandle>;
	autocomplete?: AutocompleteDropdownProps;
	queuedPrompts?: QueuedPromptItem[];
	selectedQueuedPromptId?: string | null;
	editingQueuedPrompt?: QueuedPromptItem;
	onQueuedPromptEditConfirm: (id: string, prompt: string) => void;
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
	const terminalBg = useTerminalBackground();
	const accent = getModeAccent(session.uiMode);
	const inputBackground = getModeInputBackground(session.uiMode, terminalBg);
	const inputForeground = getModeInputForeground(session.uiMode, terminalBg);
	const inputPlaceholder = getModeInputPlaceholder(session.uiMode, terminalBg);
	const placeholder =
		session.uiMode === "plan" ? "Plan something..." : "Ask anything...";
	const modelDisplayName = resolveModelDisplayName(config);
	const maxInputTokens = resolveModelMaxInputTokens(config);

	return (
		<box flexDirection="column" width="100%" height="100%">
			<ChatMessageList
				ref={props.transcriptScrollRef}
				entries={session.entries}
				isStreaming={session.isStreaming}
				uiMode={session.uiMode}
			/>

			<box flexDirection="column" flexShrink={0}>
				{props.autocomplete && (
					<AutocompleteDropdown {...props.autocomplete} accent={accent} />
				)}

				{props.queuedPrompts && props.queuedPrompts.length > 0 && (
					<QueuedPrompts
						items={props.queuedPrompts}
						selectedId={props.selectedQueuedPromptId ?? null}
						editingId={props.editingQueuedPrompt?.id ?? null}
						onEditConfirm={props.onQueuedPromptEditConfirm}
					/>
				)}

				<box marginBottom={1}>
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
						onImagePaste={onImagePaste}
						onLargeTextPaste={onLargeTextPaste}
						onFocusRequest={props.onInputFocusRequest}
						textareaRef={props.textareaRef}
					/>
				</box>

				<StatusBar
					providerId={config.providerId}
					modelId={modelDisplayName}
					totalTokens={session.lastTotalTokens}
					totalCost={session.lastTotalCost}
					maxInputTokens={maxInputTokens}
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
					variant="chat"
				/>
			</box>
		</box>
	);
}
