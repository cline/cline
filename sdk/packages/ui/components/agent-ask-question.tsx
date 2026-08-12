"use client";

import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useState,
} from "react";
import { Button } from "./button.js";

export interface AgentAskQuestionItem {
	description?: ReactNode;
	id: string;
	meta?: ReactNode;
	multiple?: boolean;
	options: readonly string[];
	question: ReactNode;
}

export interface AgentAskQuestionProps {
	errors?: Readonly<Record<string, ReactNode>>;
	items: readonly AgentAskQuestionItem[];
	onAnswer: (id: string, answer: string) => void;
	onAnswers?: (id: string, answers: readonly string[]) => void;
	pendingAnswers?: Readonly<
		Record<string, string | readonly string[] | undefined>
	>;
}

function optionLabel(index: number) {
	let value = index + 1;
	let label = "";

	while (value > 0) {
		value -= 1;
		label = String.fromCharCode(65 + (value % 26)) + label;
		value = Math.floor(value / 26);
	}

	return label;
}

function Spinner() {
	return (
		<svg
			aria-hidden="true"
			className="cline-ui-agent-ask-question__spinner mr-1 size-3.5 flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] stroke-2"
			viewBox="0 0 24 24"
		>
			<path d="M21 12a9 9 0 1 1-6.219-8.56" />
		</svg>
	);
}

export function AgentAskQuestion({
	errors = {},
	items,
	onAnswer,
	onAnswers,
	pendingAnswers = {},
}: AgentAskQuestionProps) {
	const [selections, setSelections] = useState<
		Readonly<Record<string, readonly string[]>>
	>({});

	return (
		<section
			aria-label="Follow-up question"
			className="cline-ui-agent-ask-question flex flex-col gap-2"
		>
			{items.map((item) => {
				const pendingAnswer = pendingAnswers[item.id];
				const isPending = Array.isArray(pendingAnswer)
					? pendingAnswer.length > 0
					: Boolean(pendingAnswer);
				const error = errors[item.id];
				const options = [...new Set(item.options)];
				const validSelection = (selections[item.id] ?? []).filter((option) =>
					options.includes(option),
				);
				const selected = item.multiple
					? validSelection
					: validSelection.slice(-1);
				const canSubmit =
					selected.length > 0 && (!item.multiple || Boolean(onAnswers));
				const selectOption = (option: string) => {
					setSelections((current) => {
						const currentSelection = current[item.id] ?? [];
						const nextSelection = item.multiple
							? currentSelection.includes(option)
								? currentSelection.filter((value) => value !== option)
								: [...currentSelection, option]
							: [option];

						return { ...current, [item.id]: nextSelection };
					});
				};
				const submit = () => {
					if (!canSubmit) return;
					if (item.multiple) onAnswers?.(item.id, selected);
					else onAnswer(item.id, selected[0] as string);
				};
				const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
					if (
						isPending ||
						event.repeat ||
						event.altKey ||
						event.ctrlKey ||
						event.metaKey
					)
						return;

					if (event.key === "Enter") {
						if (!canSubmit) return;
						event.preventDefault();
						submit();
						return;
					}

					if (event.key.length !== 1) return;
					const optionIndex = event.key.toUpperCase().charCodeAt(0) - 65;
					const option = options[optionIndex];
					if (!option || optionIndex > 25) return;

					event.preventDefault();
					selectOption(option);
				};

				return (
					// biome-ignore lint/a11y/noStaticElementInteractions: scopes advertised keyboard shortcuts to the focused question card.
					<div
						aria-busy={isPending || undefined}
						className="cline-ui-agent-ask-question__item"
						key={item.id}
						onKeyDown={handleKeyDown}
						tabIndex={isPending ? -1 : 0}
					>
						<div className="cline-ui-agent-ask-question__item-header flex items-start justify-between gap-3">
							<div className="min-w-0 flex-1 mt-1 mb-2">
								<div className="cline-ui-agent-ask-question__question font-cline-ui-medium text-cline-ui-foreground text-cline-ui-base">
									{item.question}
								</div>
								{item.multiple ? (
									<div className="cline-ui-agent-ask-question__multiple-hint mt-1 text-cline-ui-sm text-cline-ui-muted-foreground">
										Select all that apply.
									</div>
								) : null}
							</div>
							{item.meta ? (
								<div className="cline-ui-agent-ask-question__meta inline-flex shrink-0 items-center rounded-cline-ui-sm border border-cline-ui-border bg-cline-ui-surface-hover-lighter px-1 py-0.5 font-cline-ui-mono text-cline-ui-muted-foreground text-cline-ui-xs">
									{item.meta}
								</div>
							) : null}
						</div>
						{item.description ? (
							<div className="cline-ui-agent-ask-question__description px-4 pt-1 text-cline-ui-sm text-cline-ui-muted-foreground">
								{item.description}
							</div>
						) : null}
						{error ? (
							<div
								className="cline-ui-agent-ask-question__error mx-4 mt-2 text-cline-ui-destructive text-cline-ui-xs"
								role="alert"
							>
								{error}
							</div>
						) : null}
						<div className="cline-ui-agent-ask-question__options flex flex-col px-1 py-1">
							{/* Options are model-supplied and may repeat; repeats submit the same answer. */}
							{options.map((option, index) => (
								<Button
									aria-keyshortcuts={optionLabel(index)}
									aria-pressed={selected.includes(option)}
									className="cline-ui-agent-ask-question__option h-auto min-h-9.5 w-full max-w-full justify-start gap-3 whitespace-normal rounded-cline-ui-md p-2 text-left text-cline-ui-sm wrap-anywhere"
									disabled={isPending}
									key={option}
									onClick={() => selectOption(option)}
									size="sm"
									tone="neutral"
									variant="ghost"
								>
									<span
										aria-hidden="true"
										className="cline-ui-agent-ask-question__option-key"
									>
										{optionLabel(index)}
									</span>
									<span className="cline-ui-agent-ask-question__option-label min-w-0 flex-1 font-cline-ui-medium text-cline-ui-foreground">
										{option}
									</span>
								</Button>
							))}
						</div>
						<div className="cline-ui-agent-ask-question__footer flex items-center justify-end border-cline-ui-border border-t px-2 py-2">
							<Button
								aria-keyshortcuts="Enter"
								className="cline-ui-agent-ask-question__submit"
								disabled={!canSubmit || isPending}
								onClick={submit}
								size="sm"
								tone="neutral"
								variant="fill"
							>
								{isPending ? (
									<>
										<Spinner />
										Sending…
									</>
								) : (
									<>
										Submit
										<span aria-hidden="true" className="font-cline-ui-mono">
											⮐
										</span>
									</>
								)}
							</Button>
						</div>
					</div>
				);
			})}
		</section>
	);
}
