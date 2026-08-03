"use client";

import { type ReactNode, useId } from "react";

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
			className="cline-ui-agent-ask-question__icon"
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
			className="cline-ui-agent-ask-question__spinner"
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
	const headingId = useId();

	return (
		<section
			aria-labelledby={headingId}
			className="cline-ui-agent-ask-question"
		>
			<h2 className="cline-ui-agent-ask-question__heading" id={headingId}>
				<QuestionIcon />
				Follow-up question
			</h2>
			<p className="cline-ui-agent-ask-question__intro">
				Choose one option to continue the current agent turn.
			</p>
			<div className="cline-ui-agent-ask-question__items">
				{items.map((item) => {
					const pendingAnswer = pendingAnswers[item.id];
					const isPending = Boolean(pendingAnswer);
					const error = errors[item.id];

					return (
						<div
							aria-busy={isPending || undefined}
							className="cline-ui-agent-ask-question__item"
							key={item.id}
						>
							<div className="cline-ui-agent-ask-question__item-header">
								<div className="cline-ui-agent-ask-question__question">
									{item.question}
								</div>
								{item.meta ? (
									<div className="cline-ui-agent-ask-question__meta">
										{item.meta}
									</div>
								) : null}
							</div>
							{item.description ? (
								<div className="cline-ui-agent-ask-question__description">
									{item.description}
								</div>
							) : null}
							{error ? (
								<div
									className="cline-ui-agent-ask-question__error"
									role="alert"
								>
									{error}
								</div>
							) : null}
							<div className="cline-ui-agent-ask-question__options">
								{/* Options are model-supplied and may repeat; repeats submit the same answer. */}
								{[...new Set(item.options)].map((option) => (
									<button
										className="cline-ui-agent-ask-question__option"
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
			</div>
		</section>
	);
}
