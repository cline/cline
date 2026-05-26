import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useCallback, useRef, useState } from "react";
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

function Shell(
	props: Pick<
		InlineToolResponseProps,
		"accent" | "inputBackground" | "inputForeground"
	> & {
		title: string;
		children: React.ReactNode;
	},
) {
	const { height } = useTerminalDimensions();
	const maxHeight = Math.max(7, Math.min(14, Math.floor(height * 0.38)));

	return (
		<box
			flexDirection="column"
			width="100%"
			maxHeight={maxHeight}
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
	const [selected, setSelected] = useState(0);
	const [customValue, setCustomValue] = useState("");
	const [customEmptyAttempted, setCustomEmptyAttempted] = useState(false);
	const selectedRef = useRef(0);
	const customValueRef = useRef("");
	const interactionId = interaction.id;
	const onResolveAskQuestion = props.onResolveAskQuestion;
	const customIndex = interaction.options.length;
	const isTyping = selected === customIndex;
	const totalChoices = interaction.options.length + 1;

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
		>
			<text fg={props.inputForeground} selectable>
				{interaction.question}
			</text>

			<box flexDirection="column">
				{interaction.options.map((option, index) => {
					const optionSelected = !isTyping && selected === index;
					return (
						<box
							key={`${index.toString()}:${option}`}
							paddingX={1}
							flexDirection="row"
							gap={1}
							backgroundColor={optionSelected ? palette.selection : undefined}
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
							>
								{option}
							</text>
						</box>
					);
				})}
				<box
					paddingX={1}
					flexDirection="row"
					gap={1}
					backgroundColor={isTyping ? palette.selection : undefined}
					onMouseDown={() => selectIndex(customIndex)}
				>
					<text fg={isTyping ? palette.textOnSelection : "gray"} flexShrink={0}>
						{isTyping ? ">" : " "}
					</text>
					{isTyping ? (
						<text fg={palette.textOnSelection} flexGrow={1}>
							{customValue
								? `${customValue}|`
								: customEmptyAttempted
									? "Type a response first..."
									: "Type a response..."}
						</text>
					) : (
						<text fg={props.inputPlaceholder}>Type a response...</text>
					)}
				</box>
			</box>
		</Shell>
	);
}

export function InlineToolResponse(props: InlineToolResponseProps) {
	if (props.interaction.kind === "tool_approval") {
		return <ToolApprovalResponse {...props} interaction={props.interaction} />;
	}

	return <AskQuestionResponse {...props} interaction={props.interaction} />;
}
