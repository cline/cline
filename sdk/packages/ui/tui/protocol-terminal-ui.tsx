import type { UiConnection, UiOutboundMessage } from "@cline/shared";
import { createCliRenderer, type KeyEvent } from "@opentui/core";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import type React from "react";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import {
	appendUserPrompt,
	createUiTranscriptState,
	reduceUiMessage,
	type UiTranscriptBlock,
	type UiTranscriptState,
} from "../protocol/transcript";
import { ChatMessageList } from "./components/chat-message-list";
import type { TextareaHandle } from "./components/input-bar";
import { formatToolInput, formatToolOutput } from "./formatting/tool-format";
import { ThemeProvider } from "./hooks/theme-provider";
import { TerminalColorsContext, useTheme } from "./hooks/use-theme";
import { installTuiStdioCapture } from "./stdio-capture";
import { resolveTheme } from "./themes";
import type { ChatEntry } from "./types";

export interface ProtocolTerminalUiProps {
	/** Host-provided duplex connection; the UI never touches the transport. */
	connection: UiConnection;
	title?: string;
}

export interface TerminalUiHandle {
	destroy: () => void;
	waitUntilExit: () => Promise<void>;
}

/** Convert semantic transcript blocks into renderable chat entries. */
export function transcriptBlocksToChatEntries(
	blocks: UiTranscriptBlock[],
): ChatEntry[] {
	const entries: ChatEntry[] = [];
	for (const block of blocks) {
		switch (block.kind) {
			case "user":
				entries.push({ kind: "user_submitted", text: block.text });
				break;
			case "assistant_text":
				entries.push({
					kind: "assistant_text",
					text: block.text,
					streaming: block.streaming,
				});
				break;
			case "reasoning":
				entries.push({
					kind: "reasoning",
					text: block.text,
					streaming: block.streaming,
				});
				break;
			case "tool":
				entries.push({
					kind: "tool_call",
					toolCallId: block.toolCallId,
					toolName: block.toolName,
					inputSummary: formatToolInput(block.toolName, block.input),
					rawInput: block.input,
					streaming: block.status === "running",
					result:
						block.status === "running"
							? undefined
							: {
									outputSummary: block.error
										? ""
										: formatToolOutput(block.output),
									rawOutput: block.output,
									error: block.error,
								},
				});
				break;
			case "media":
				entries.push({
					kind: "assistant_media",
					modality: block.modality,
					mediaType: block.mediaType,
					byteLength: block.sizeBytes ?? 0,
				});
				break;
			case "status":
				entries.push({ kind: "status", text: block.text });
				break;
			case "error":
				entries.push({ kind: "error", text: block.text });
				break;
			case "turn_done": {
				const usage = block.usage;
				entries.push({
					kind: "done",
					tokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
					cost: usage?.totalCost ?? 0,
					elapsed: "",
					iterations: block.iterations,
				});
				break;
			}
		}
	}
	return entries;
}

function transcriptReducer(
	state: UiTranscriptState,
	action:
		| { type: "message"; message: UiOutboundMessage }
		| { type: "user"; prompt: string },
): UiTranscriptState {
	if (action.type === "user") {
		return appendUserPrompt(state, action.prompt);
	}
	return reduceUiMessage(state, action.message);
}

function ProtocolStatusLine(props: {
	state: UiTranscriptState;
	title?: string;
}) {
	const theme = useTheme();
	const { state } = props;
	const provider = state.defaults?.provider;
	const model = state.defaults?.model;
	const left = [
		props.title ?? "Cline",
		state.sessionId ? `session ${state.sessionId.slice(0, 12)}` : undefined,
		provider && model ? `${provider}/${model}` : (provider ?? model),
	]
		.filter(Boolean)
		.join("  ·  ");
	const right = state.running
		? "working... (Esc to abort)"
		: (state.status ?? "idle");
	return (
		<box
			flexDirection="row"
			justifyContent="space-between"
			paddingLeft={1}
			paddingRight={1}
		>
			<text fg={"gray"}>{left}</text>
			<text fg={state.running ? theme.accents.act : "gray"}>{right}</text>
		</box>
	);
}

function ProtocolApp(props: {
	connection: UiConnection;
	title?: string;
	onExit: () => void;
}) {
	const { connection, onExit } = props;
	const [state, dispatch] = useReducer(
		transcriptReducer,
		undefined,
		createUiTranscriptState,
	);
	const [inputKey, setInputKey] = useState(0);
	const textareaRef = useRef<TextareaHandle | null>(null);
	const historyRef = useRef<string[]>([]);
	const historyIndexRef = useRef(-1);
	const savedInputRef = useRef("");
	const { height: termHeight } = useTerminalDimensions();

	useEffect(() => {
		const unsubscribe = connection.subscribe((message) => {
			dispatch({ type: "message", message });
		});
		void connection.send({ type: "ready" });
		return unsubscribe;
	}, [connection]);

	const submit = useCallback(
		(raw: string) => {
			const prompt = raw.trim();
			if (!prompt) return;
			historyRef.current = [
				prompt,
				...historyRef.current.filter((entry) => entry !== prompt),
			].slice(0, 50);
			historyIndexRef.current = -1;
			if (prompt === "/quit" || prompt === "/exit") {
				onExit();
				return;
			}
			if (prompt === "/abort") {
				void connection.send({ type: "abort" });
				return;
			}
			if (prompt === "/reset") {
				void connection.send({ type: "reset" });
				return;
			}
			dispatch({ type: "user", prompt });
			void connection.send({ type: "send", prompt });
		},
		[connection, onExit],
	);

	const navigateHistory = useCallback((direction: "up" | "down") => {
		const ta = textareaRef.current;
		if (!ta) return;
		const entries = historyRef.current;
		if (entries.length === 0) return;
		if (historyIndexRef.current === -1) {
			if (direction === "down") return;
			savedInputRef.current = ta.plainText;
		}
		if (direction === "up") {
			if (historyIndexRef.current < entries.length - 1) {
				historyIndexRef.current += 1;
			} else {
				return;
			}
		} else if (historyIndexRef.current > -1) {
			historyIndexRef.current -= 1;
		} else {
			return;
		}
		const text =
			historyIndexRef.current === -1
				? savedInputRef.current
				: (entries[historyIndexRef.current] ?? "");
		ta.setText(text);
		ta.cursorOffset = text.length;
	}, []);

	useKeyboard((key: KeyEvent) => {
		if (key.name === "escape") {
			if (state.running) {
				void connection.send({ type: "abort" });
			}
			return;
		}
		if (key.name === "c" && key.ctrl) {
			onExit();
			return;
		}
		if (key.name === "up") {
			navigateHistory("up");
			return;
		}
		if (key.name === "down") {
			navigateHistory("down");
		}
	});

	const entries = useMemo(
		() => transcriptBlocksToChatEntries(state.blocks),
		[state.blocks],
	);

	const textareaRefCallback = useCallback(
		(node: TextareaHandle | null) => {
			textareaRef.current = node;
			if (node) {
				node.onSubmit = () => {
					const text = node.plainText;
					submit(text);
					setInputKey((key) => key + 1);
				};
			}
		},
		[submit],
	);

	const theme = useTheme();
	const queuedCount = state.pendingPrompts.length;

	return (
		<box flexDirection="column" width="100%" height="100%">
			<ProtocolStatusLine state={state} title={props.title} />
			<box flexGrow={1} minHeight={Math.max(3, termHeight - 6)}>
				<ChatMessageList entries={entries} isStreaming={state.running} />
			</box>
			{queuedCount > 0 ? (
				<box paddingLeft={1}>
					<text fg={"gray"}>
						{`${queuedCount} queued prompt${queuedCount === 1 ? "" : "s"}`}
					</text>
				</box>
			) : null}
			<box
				flexDirection="row"
				border={["top"]}
				borderStyle="single"
				borderColor={"gray"}
			>
				<text fg={theme.accents.act}>
					<strong>{"❯ "}</strong>
				</text>
				<box flexGrow={1}>
					<textarea
						key={inputKey}
						ref={textareaRefCallback as React.RefCallback<never>}
						focused
						flexGrow={1}
						minHeight={1}
						maxHeight={4}
						wrapMode="word"
						placeholder="Type a prompt, /reset, /abort, or /quit"
						keyBindings={[{ name: "return", action: "submit" }]}
					/>
				</box>
			</box>
		</box>
	);
}

/**
 * Boot the protocol-driven terminal client: a thin renderer over a
 * `UiConnection`. It never creates sessions, touches persistence, or knows
 * the transport behind the connection.
 */
export async function runProtocolTerminalUi(
	props: ProtocolTerminalUiProps,
): Promise<TerminalUiHandle> {
	const renderer = await createCliRenderer({
		exitOnCtrlC: false,
		autoFocus: false,
	});
	const restoreStdio = installTuiStdioCapture();

	const detectedPalette = await renderer
		.getPalette({ timeout: 150 })
		.catch(() => null);
	const terminalBackground = detectedPalette?.defaultBackground ?? null;
	const terminalForeground = detectedPalette?.defaultForeground ?? null;
	const initialTheme = resolveTheme("auto", {
		background: terminalBackground,
		foreground: terminalForeground,
	});
	if (initialTheme.appBackground) {
		renderer.setBackgroundColor(initialTheme.appBackground);
	}

	let resolveExit: (() => void) | undefined;
	const exitPromise = new Promise<void>((resolve) => {
		resolveExit = resolve;
	});

	const root = createRoot(renderer);

	let destroyStarted = false;
	const destroy = () => {
		if (destroyStarted) return;
		destroyStarted = true;
		root.unmount();
		queueMicrotask(() => {
			if (!renderer.isDestroyed) {
				renderer.destroy();
			}
		});
	};

	renderer.on("destroy", () => {
		restoreStdio();
		resolveExit?.();
	});

	root.render(
		<TerminalColorsContext
			value={{
				background: terminalBackground,
				foreground: terminalForeground,
			}}
		>
			<ThemeProvider>
				<ProtocolApp
					connection={props.connection}
					title={props.title}
					onExit={destroy}
				/>
			</ThemeProvider>
		</TerminalColorsContext>,
	);

	return {
		destroy,
		waitUntilExit: () => exitPromise,
	};
}
