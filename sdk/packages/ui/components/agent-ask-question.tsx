"use client";

import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useState,
} from "react";
import { Badge } from "./badge.js";
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
	const [customAnswers, setCustomAnswers] = useState<
		Readonly<Record<string, string>>
	>({});

	return (
		<section
			aria-label="Follow-up question"
			className="cline-ui-agent-ask-question flex flex-col gap-2"
		>
			{items.map((item, itemIndex) => {
				const pendingAnswer = pendingAnswers[item.id];
				const isPending = Array.isArray(pendingAnswer)
					? pendingAnswer.length > 0
					: Boolean(pendingAnswer);
				const error = errors[item.id];
				const options = [...new Set(item.options)];
				const pendingSelection = (
					Array.isArray(pendingAnswer)
						? pendingAnswer
						: pendingAnswer
							? [pendingAnswer]
							: []
				).filter((option) => options.includes(option));
				const selected = (
					isPending ? pendingSelection : (selections[item.id] ?? [])
				).filter((option) => options.includes(option));
				const customAnswer = customAnswers[item.id] ?? "";
				const canSubmit = item.multiple
					? selected.length > 0 && Boolean(onAnswers)
					: customAnswer.trim().length > 0;
				// Single-choice items answer as soon as an option is picked; only
				// multiple-choice items collect a selection for explicit submission.
				const selectOption = (option: string) => {
					if (!item.multiple) {
						onAnswer(item.id, option);
						return;
					}
					setSelections((current) => {
						const currentSelection = current[item.id] ?? [];
						const nextSelection = currentSelection.includes(option)
							? currentSelection.filter((value) => value !== option)
							: [...currentSelection, option];

						return { ...current, [item.id]: nextSelection };
					});
				};
				const submit = () => {
					if (!canSubmit || isPending) return;
					if (item.multiple) onAnswers?.(item.id, selected);
					else onAnswer(item.id, customAnswer.trim());
				};
				const handleOptionKeyDown = (
					event: ReactKeyboardEvent<HTMLFieldSetElement>,
				) => {
					if (isPending || event.altKey || event.ctrlKey || event.metaKey)
						return;

					const optionButtons = Array.from(
						event.currentTarget.querySelectorAll<HTMLButtonElement>(
							".cline-ui-agent-ask-question__option:not(:disabled)",
						),
					);
					const activeIndex = optionButtons.indexOf(
						document.activeElement as HTMLButtonElement,
					);

					if (event.key === "ArrowDown" || event.key === "ArrowRight") {
						event.preventDefault();
						optionButtons[(activeIndex + 1) % optionButtons.length]?.focus();
						return;
					}
					if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
						event.preventDefault();
						optionButtons[
							(activeIndex - 1 + optionButtons.length) % optionButtons.length
						]?.focus();
						return;
					}

					if (/^[a-z]$/i.test(event.key)) {
						const optionIndex = event.key.toUpperCase().charCodeAt(0) - 65;
						const option = options[optionIndex];
						if (option) {
							event.preventDefault();
							selectOption(option);
							optionButtons[optionIndex]?.focus();
						}
					}
				};

				return (
					<div
						aria-busy={isPending || undefined}
						className="cline-ui-agent-ask-question__item"
						key={item.id}
					>
						<div className="cline-ui-agent-ask-question__item-header flex items-start justify-between gap-3">
							<div className="min-w-0 flex-1 mt-1 w-full flex">
								<div className="flex justify-between gap-1 w-full flex-col">
									<h5 className="cline-ui-agent-ask-question__question font-cline-ui-medium text-cline-ui-foreground text-cline-ui-base w-full">
										{item.question}
									</h5>

									{item.multiple ? (
										<div className="cline-ui-agent-ask-question__multiple-hint text-cline-ui-sm text-cline-ui-muted-foreground">
											Select all that apply.
										</div>
									) : null}
									{item.description ? (
										<div className="cline-ui-agent-ask-question__description text-cline-ui-sm text-cline-ui-muted-foreground">
											{item.description}
										</div>
									) : null}
								</div>
								{item.meta ? (
									<Badge className="cline-ui-agent-ask-question__meta h-fit -mt-1">
										{item.meta}
									</Badge>
								) : null}
							</div>
						</div>

						<fieldset
							aria-label="Answer options"
							className="cline-ui-agent-ask-question__options m-0 flex min-w-0 flex-col border-0 px-1 py-4"
							onKeyDown={handleOptionKeyDown}
						>
							{/* Options are model-supplied and may repeat; repeats submit the same answer. */}
							{options.map((option, index) => (
								<Button
									aria-pressed={selected.includes(option)}
									autoFocus={itemIndex === 0 && index === 0 && !isPending}
									className="cline-ui-agent-ask-question__option h-auto min-h-9.5 w-full max-w-full justify-start gap-3 rounded-cline-ui-md p-2 text-left text-cline-ui-sm"
									disabled={isPending}
									key={option}
									onClick={() => selectOption(option)}
									size="sm"
									tone="neutral"
									variant="ghost"
								>
									{index < 26 ? (
										<span
											aria-hidden="true"
											className="cline-ui-agent-ask-question__option-key"
										>
											{optionLabel(index)}
										</span>
									) : null}
									<span className="cline-ui-agent-ask-question__option-label min-w-0 flex-1 font-cline-ui-medium text-cline-ui-foreground">
										{option}
									</span>
								</Button>
							))}
						</fieldset>
						<div className="cline-ui-agent-ask-question__footer flex flex-col gap-2 border-cline-ui-border border-t px-2 py-2">
							{error ? (
								<div
									className="cline-ui-agent-ask-question__error text-cline-ui-destructive text-cline-ui-xs px-2"
									role="alert"
								>
									{error}
								</div>
							) : null}
							<div className="flex items-center justify-end gap-2">
								{item.multiple ? null : (
									<input
										aria-label="Custom answer"
										className="cline-ui-agent-ask-question__custom min-w-0 flex-1 h-8 rounded-cline-ui-md border border-cline-ui-border bg-cline-ui-background px-2 text-cline-ui-foreground text-cline-ui-sm outline-none focus:border-[color-mix(in_oklab,var(--cline-ui-primary)_50%,transparent)] focus:shadow-[0_0_0_1px_color-mix(in_oklab,var(--cline-ui-primary)_20%,transparent)]"
										disabled={isPending}
										onChange={(event) => {
											const value = event.target.value;
											setCustomAnswers((current) => ({
												...current,
												[item.id]: value,
											}));
										}}
										onKeyDown={(event) => {
											if (event.key === "Enter" && !event.shiftKey) {
												event.preventDefault();
												submit();
											}
										}}
										placeholder="Or type your own answer…"
										type="text"
										value={customAnswer}
									/>
								)}
								<Button
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
										"Submit"
									)}
								</Button>
							</div>
						</div>
					</div>
				);
			})}
		</section>
	);
}
