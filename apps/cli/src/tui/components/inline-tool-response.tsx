import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { palette } from "../palette";
import type { RuntimeToolInteraction } from "../types";
import { formatApprovalParams } from "./dialogs/tool-approval";

export interface InlineToolResponseProps {
	interaction: RuntimeToolInteraction;
	accent: string;
	inputBackground: string;
	inputForeground: string;
	inputPlaceholder: string;
	onResolveToolApproval: (id: number, approved: boolean) => void;
	onResolveAskQuestion: (id: number, answer: string | null) => void;
}

function isPrintableKey(name: string): boolean {
	return name.length === 1 || name === "space";
}

function keyToText(name: string): string {
	return name === "space" ? " " : name;
}

function getToolShellMaxHeight(terminalHeight: number): number {
	return Math.max(7, Math.min(14, Math.floor(terminalHeight * 0.38)));
}

function getAskQuestionShellMaxHeight(terminalHeight: number): number {
	const preferredHeight = Math.max(11, Math.floor(terminalHeight * 0.58));
	const availableHeight = Math.max(7, terminalHeight - 3);
	return Math.min(18, preferredHeight, availableHeight);
}

function getAskQuestionBodyHeight(shellMaxHeight: number): number {
	return Math.max(1, shellMaxHeight - 4);
}

function countWrappedRows(text: string, width: number): number {
	const safeWidth = Math.max(1, width);
	const paragraphs = text.split("\n");
	let rows = 0;

	for (const paragraph of paragraphs) {
		rows += 1;
		let lineWidth = 0;
		const words = paragraph.trim().split(/\s+/).filter(Boolean);

		for (const word of words) {
			const wordWidth = Bun.stringWidth(word);
			if (lineWidth === 0) {
				rows += Math.max(0, Math.ceil(wordWidth / safeWidth) - 1);
				lineWidth = wordWidth % safeWidth || safeWidth;
				continue;
			}

			if (lineWidth + 1 + wordWidth <= safeWidth) {
				lineWidth += 1 + wordWidth;
				continue;
			}

			rows += 1;
			rows += Math.max(0, Math.ceil(wordWidth / safeWidth) - 1);
			lineWidth = wordWidth % safeWidth || safeWidth;
		}
	}

	return rows;
}

function getAskQuestionContentHeight(input: {
	terminalWidth: number;
	question: string;
	options: string[];
	customText: string;
}): number {
	const questionWidth = Math.max(1, input.terminalWidth - 3);
	const optionTextWidth = Math.max(1, input.terminalWidth - 7);
	const questionRows = countWrappedRows(input.question, questionWidth);
	const optionRows = input.options.reduce(
		(rows, option) => rows + countWrappedRows(option, optionTextWidth),
		0,
	);
	const customRows = countWrappedRows(input.customText, optionTextWidth);
	return questionRows + 1 + optionRows + customRows;
}

function getAskQuestionChoiceId(interactionId: number, index: number): string {
	return `ask-question-${interactionId.toString()}-choice-${index.toString()}`;
}

function Shell(
	props: Pick<
		InlineToolResponseProps,
		"accent" | "inputBackground" | "inputForeground"
	> & {
		title: string;
		maxHeight?: number;
		children: React.ReactNode;
	},
) {
	const { height } = useTerminalDimensions();
	const maxHeight = props.maxHeight ?? getToolShellMaxHeight(height);

	return (
		<box
			flexDirection="column"
			width="100%"
			maxHeight={maxHeight}
			overflow="hidden"
			backgroundColor={props.inputBackground}
			paddingX={1}
			paddingY={1}
			gap={1}
		>
			<box flexDirection="row" gap={1}>
				<text fg={palette.act}>{props.title}</text>
			</box>
			{props.children}
		</box>
	);
}

function ChoiceButton(props: {
	label: string;
	selected: boolean;
	selectedFg?: string;
	onPress: () => void;
}) {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI boxes handle terminal mouse input.
		<box
			paddingX={1}
			backgroundColor={props.selected ? palette.selection : undefined}
			onMouseDown={props.onPress}
		>
			<text
				fg={
					props.selected
						? (props.selectedFg ?? palette.textOnSelection)
						: undefined
				}
			>
				{props.label}
			</text>
		</box>
	);
}

function ToolApprovalResponse(
	props: InlineToolResponseProps & {
		interaction: Extract<RuntimeToolInteraction, { kind: "tool_approval" }>;
	},
) {
	const [selected, setSelected] = useState<"approve" | "deny">("approve");
	const selectedRef = useRef(selected);
	selectedRef.current = selected;
	const request = props.interaction.request;
	const interactionId = props.interaction.id;
	const onResolveToolApproval = props.onResolveToolApproval;
	const params = formatApprovalParams(request.toolName, request.input);

	const resolve = useCallback(
		(approved: boolean) => {
			onResolveToolApproval(interactionId, approved);
		},
		[interactionId, onResolveToolApproval],
	);

	useKeyboard((key) => {
		if (key.name === "y") {
			resolve(true);
			return;
		}
		if (key.name === "n" || key.name === "escape") {
			resolve(false);
			return;
		}
		if (key.name === "left" || key.name === "right" || key.name === "tab") {
			setSelected((current) => (current === "approve" ? "deny" : "approve"));
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			resolve(selectedRef.current === "approve");
		}
	});

	return (
		<Shell
			title="Cline needs permission"
			accent={props.accent}
			inputBackground={props.inputBackground}
			inputForeground={props.inputForeground}
		>
			<box flexDirection="column" gap={1}>
				<text fg="yellow">Approve tool call?</text>
				<text fg={props.accent} selectable>
					{request.toolName}
				</text>
				{params && (
					<box flexDirection="column" overflow="hidden">
						{params}
					</box>
				)}
			</box>
			<box flexDirection="row" gap={1}>
				<ChoiceButton
					label="[y] Approve"
					selected={selected === "approve"}
					onPress={() => resolve(true)}
				/>
				<ChoiceButton
					label="[n] Deny"
					selected={selected === "deny"}
					onPress={() => resolve(false)}
				/>
			</box>
		</Shell>
	);
}

function AskQuestionResponse(
	props: InlineToolResponseProps & {
		interaction: Extract<RuntimeToolInteraction, { kind: "ask_question" }>;
	},
) {
	const { interaction } = props;
	const { height, width } = useTerminalDimensions();
	const [selected, setSelected] = useState(0);
	const [customValue, setCustomValue] = useState("");
	const [customEmptyAttempted, setCustomEmptyAttempted] = useState(false);
	const scrollRef = useRef<ScrollBoxRenderable | null>(null);
	const selectedRef = useRef(0);
	const customValueRef = useRef("");
	const interactionId = interaction.id;
	const onResolveAskQuestion = props.onResolveAskQuestion;
	const customIndex = interaction.options.length;
	const isTyping = selected === customIndex;
	const totalChoices = interaction.options.length + 1;
	const shellMaxHeight = getAskQuestionShellMaxHeight(height);
	const maxBodyHeight = getAskQuestionBodyHeight(shellMaxHeight);
	const customText = isTyping
		? customValue
			? `${customValue}|`
			: customEmptyAttempted
				? "Type a response first..."
				: "Type a response..."
		: "Type a response...";
	const bodyHeight = Math.min(
		maxBodyHeight,
		getAskQuestionContentHeight({
			terminalWidth: width,
			question: interaction.question,
			options: interaction.options,
			customText,
		}),
	);

	const selectIndex = useCallback(
		(index: number) => {
			selectedRef.current = index;
			setSelected(index);
			if (index !== customIndex) {
				setCustomEmptyAttempted(false);
			}
		},
		[customIndex],
	);

	const setCustomText = useCallback((value: string) => {
		customValueRef.current = value;
		setCustomValue(value);
		if (value.trim()) {
			setCustomEmptyAttempted(false);
		}
	}, []);

	const resolveAnswer = useCallback(
		(answer: string | null) => {
			onResolveAskQuestion(interactionId, answer);
		},
		[interactionId, onResolveAskQuestion],
	);

	useEffect(() => {
		const choiceId = getAskQuestionChoiceId(interactionId, selected);
		const scrollSelectedChoiceIntoView = () => {
			scrollRef.current?.scrollChildIntoView(choiceId);
		};

		scrollSelectedChoiceIntoView();
		queueMicrotask(scrollSelectedChoiceIntoView);
	}, [interactionId, selected]);

	useKeyboard((key) => {
		const typing = selectedRef.current === customIndex;
		if (key.name === "escape") {
			if (typing && customValueRef.current) {
				setCustomText("");
				return;
			}
			resolveAnswer(null);
			return;
		}
		if (typing && key.name === "backspace") {
			setCustomText(customValueRef.current.slice(0, -1));
			return;
		}
		if (typing && key.name === "delete") {
			setCustomText("");
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			if (typing) {
				const answer = customValueRef.current.trim();
				if (answer) {
					resolveAnswer(answer);
					return;
				}
				setCustomEmptyAttempted(true);
				return;
			}
			resolveAnswer(interaction.options[selectedRef.current] ?? "");
			return;
		}
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			const next =
				selectedRef.current <= 0 ? totalChoices - 1 : selectedRef.current - 1;
			selectIndex(next);
			return;
		}
		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			const next =
				selectedRef.current >= totalChoices - 1 ? 0 : selectedRef.current + 1;
			selectIndex(next);
			return;
		}
		if (!typing && key.name >= "1" && key.name <= "9") {
			const index = Number.parseInt(key.name, 10) - 1;
			const option = interaction.options[index];
			if (option) {
				resolveAnswer(option);
				return;
			}
		}
		if (typing && !key.ctrl && !key.meta && isPrintableKey(key.name)) {
			const value = keyToText(key.name);
			setCustomText(`${customValueRef.current}${value}`);
			return;
		}
		if (!key.ctrl && !key.meta && isPrintableKey(key.name)) {
			const value = keyToText(key.name);
			setCustomText(value);
			selectIndex(customIndex);
		}
	});

	return (
		<Shell
			title="Cline is asking a question"
			accent={props.accent}
			inputBackground={props.inputBackground}
			inputForeground={props.inputForeground}
			maxHeight={shellMaxHeight}
		>
			<scrollbox
				ref={scrollRef}
				height={bodyHeight}
				width="100%"
				scrollY
				scrollX={false}
				viewportOptions={{ overflow: "hidden" }}
				contentOptions={{ flexDirection: "column" }}
			>
				<box flexDirection="column" gap={1} flexShrink={0} width="100%">
					<text fg={props.inputForeground} selectable flexShrink={0}>
						{interaction.question}
					</text>

					<box flexDirection="column" flexShrink={0} width="100%">
						{interaction.options.map((option, index) => {
							const optionSelected = !isTyping && selected === index;
							return (
								// biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI boxes handle terminal mouse input.
								<box
									id={getAskQuestionChoiceId(interactionId, index)}
									key={`${index.toString()}:${option}`}
									paddingX={1}
									flexDirection="row"
									gap={1}
									flexShrink={0}
									width="100%"
									backgroundColor={
										optionSelected ? palette.selection : undefined
									}
									onMouseDown={() => resolveAnswer(option)}
								>
									<text
										fg={optionSelected ? palette.textOnSelection : "gray"}
										flexShrink={0}
									>
										{optionSelected ? ">" : " "}
									</text>
									<text
										fg={
											optionSelected
												? palette.textOnSelection
												: props.inputForeground
										}
										flexGrow={1}
										flexShrink={1}
									>
										{option}
									</text>
								</box>
							);
						})}
						{/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI boxes handle terminal mouse input. */}
						<box
							id={getAskQuestionChoiceId(interactionId, customIndex)}
							paddingX={1}
							flexDirection="row"
							gap={1}
							flexShrink={0}
							width="100%"
							backgroundColor={isTyping ? palette.selection : undefined}
							onMouseDown={() => selectIndex(customIndex)}
						>
							<text
								fg={isTyping ? palette.textOnSelection : "gray"}
								flexShrink={0}
							>
								{isTyping ? ">" : " "}
							</text>
							{isTyping ? (
								<text fg={palette.textOnSelection} flexGrow={1} flexShrink={1}>
									{customText}
								</text>
							) : (
								<text fg={props.inputPlaceholder} flexGrow={1} flexShrink={1}>
									Type a response...
								</text>
							)}
						</box>
					</box>
				</box>
			</scrollbox>
		</Shell>
	);
}

export function InlineToolResponse(props: InlineToolResponseProps) {
	if (props.interaction.kind === "tool_approval") {
		return <ToolApprovalResponse {...props} interaction={props.interaction} />;
	}

	return <AskQuestionResponse {...props} interaction={props.interaction} />;
}
