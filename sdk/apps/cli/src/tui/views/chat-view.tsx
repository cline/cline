import {
	AutocompleteDropdown,
	type AutocompleteDropdownProps,
} from "../components/autocomplete-dropdown";
import { ChatMessageList } from "../components/chat-message-list";
import { InputBar, type TextareaHandle } from "../components/input-bar";
import { QueuedPrompts } from "../components/queued-prompts";
import {
	resolveModelContextWindow,
	resolveModelDisplayName,
	StatusBar,
} from "../components/status-bar";
import { useSession } from "../contexts/session-context";
import { getModeAccent } from "../palette";
import type { QueuedPromptItem, TuiProps } from "../types";

export function ChatView(props: {
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
	queuedPrompts?: QueuedPromptItem[];
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
	const accent = getModeAccent(session.uiMode);
	const placeholder =
		session.uiMode === "plan" ? "Plan something..." : "Ask anything...";
	const modelDisplayName = resolveModelDisplayName(config);
	const contextWindow = resolveModelContextWindow(config);

	return (
		<box flexDirection="column" width="100%" height="100%">
			<ChatMessageList
				entries={session.entries}
				isStreaming={session.isStreaming}
				uiMode={session.uiMode}
			/>

			<box flexDirection="column" flexShrink={0}>
				{props.autocomplete && (
					<AutocompleteDropdown {...props.autocomplete} accent={accent} />
				)}

				{props.queuedPrompts && props.queuedPrompts.length > 0 && (
					<QueuedPrompts items={props.queuedPrompts} />
				)}

				<InputBar
					accent={accent}
					placeholder={placeholder}
					initialValue={inputValue}
					inputKey={inputKey}
					onSubmit={onSubmit}
					onContentChange={onContentChange}
					onImagePaste={onImagePaste}
					onLargeTextPaste={onLargeTextPaste}
					textareaRef={props.textareaRef}
				/>

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
					variant="chat"
				/>
			</box>
		</box>
	);
}
