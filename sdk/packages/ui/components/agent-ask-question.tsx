"use client";

import type { ReactNode } from "react";

export interface AgentAskQuestionItem {
	description?: ReactNode;
	id: string;
	meta?: ReactNode;
	options: readonly string[];
	question: ReactNode;
}

export interface AgentAskQuestionProps {
	errors?: Readonly<Record<string, ReactNode>>;
	items: readonly AgentAskQuestionItem[];
	onAnswer: (id: string, answer: string) => void;
	pendingAnswers?: Readonly<Record<string, string | undefined>>;
}

function QuestionIcon() {
	return (
		<svg
			aria-hidden="true"
			className="cline-ui-agent-ask-question__icon size-4 fill-none stroke-[var(--cline-ui-agent-ask-question-accent)] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]"
			viewBox="0 0 24 24"
		>
			<path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
			<path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1" />
		</svg>
	);
}

function Spinner() {
	return (
		<svg
			aria-hidden="true"
			className="cline-ui-agent-ask-question__spinner mr-1 size-3.5 flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]"
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
	pendingAnswers = {},
}: AgentAskQuestionProps) {
	return (
		<section
			aria-label="Follow-up question"
			className="cline-ui-agent-ask-question flex flex-col gap-2"
		>
			{items.map((item) => {
				const pendingAnswer = pendingAnswers[item.id];
				const isPending = Boolean(pendingAnswer);
				const error = errors[item.id];

				return (
					<div
						aria-busy={isPending || undefined}
						className="cline-ui-agent-ask-question__item rounded-cline-ui-xl border border-[color-mix(in_oklab,var(--cline-ui-agent-ask-question-accent-border)_40%,transparent)] bg-[color-mix(in_oklab,var(--cline-ui-agent-ask-question-accent)_5%,transparent)] p-3"
						key={item.id}
					>
						<div className="cline-ui-agent-ask-question__item-header flex items-start justify-between gap-2">
							<div className="cline-ui-agent-ask-question__question flex items-center gap-2 font-cline-ui-medium text-cline-ui-foreground text-cline-ui-sm">
								<QuestionIcon />
								{item.question}
							</div>
							{item.meta ? (
								<div className="cline-ui-agent-ask-question__meta inline-flex items-center gap-1 text-[11px] text-cline-ui-muted-foreground">
									{item.meta}
								</div>
							) : null}
						</div>
						{item.description ? (
							<div className="cline-ui-agent-ask-question__description mt-1 pl-6 text-[11px] text-cline-ui-muted-foreground">
								{item.description}
							</div>
						) : null}
						{error ? (
							<div
								className="cline-ui-agent-ask-question__error mt-2 pl-6 text-cline-ui-destructive text-cline-ui-xs"
								role="alert"
							>
								{error}
							</div>
						) : null}
						<div className="cline-ui-agent-ask-question__options mt-2.5 flex flex-wrap items-center gap-2 pl-6">
							{/* Options are model-supplied and may repeat; repeats submit the same answer. */}
							{[...new Set(item.options)].map((option) => (
								<button
									className="cline-ui-agent-ask-question__option inline-flex min-h-8 max-w-full flex-none cursor-pointer items-center justify-center gap-1.5 whitespace-normal rounded-cline-ui-md border border-cline-ui-border bg-cline-ui-background px-3 py-0 font-cline-ui-medium text-cline-ui-foreground shadow-xs transition-[color,background-color,border-color,box-shadow] duration-150 ease-[ease] [overflow-wrap:anywhere] [&:hover]:bg-cline-ui-accent [&:hover]:text-cline-ui-accent-foreground focus-visible:outline-3 focus-visible:outline-cline-ui-ring/50 focus-visible:outline-offset-0 disabled:pointer-events-none disabled:opacity-50 cline-ui-dark:border-cline-ui-input cline-ui-dark:bg-cline-ui-input/30 cline-ui-dark:[&:hover]:bg-cline-ui-input/50"
									disabled={isPending}
									key={option}
									onClick={() => onAnswer(item.id, option)}
									type="button"
								>
									{pendingAnswer === option ? (
										<>
											<Spinner />
											Sending…
										</>
									) : (
										option
									)}
								</button>
							))}
						</div>
					</div>
				);
			})}
		</section>
	);
}
