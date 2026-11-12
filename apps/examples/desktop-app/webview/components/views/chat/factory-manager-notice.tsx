"use client";

import { formatFactoryId } from "@cline/shared/browser";
import { MessageSquare } from "lucide-react";
import { useMemo } from "react";
import { useAgendaTasks } from "@/hooks/use-agenda-tasks";
import { FACTORY_MANAGER } from "@/lib/factory-copy";
import { FACTORY_AGENDA_FILTERS } from "../factory/factory-ui";

type CardLike = {
	factoryNumber?: number;
	status: string;
	updatedAt: string;
	archivedAt?: string;
};

const ENDED = new Set(["cancelled", "expired"]);

/**
 * The card to name in the "How is F12 going?" example: the most recently
 * updated open card, else the most recent card. Undefined when no card has
 * a short id, so the example is left out rather than naming a card that
 * doesn't exist.
 */
export function factoryManagerExampleCardId(
	tasks: readonly CardLike[],
): string | undefined {
	const numbered = tasks.filter(
		(task): task is CardLike & { factoryNumber: number } =>
			typeof task.factoryNumber === "number",
	);
	const newest = (list: typeof numbered) =>
		list.reduce<(typeof numbered)[number] | undefined>(
			(best, task) =>
				!best || Date.parse(task.updatedAt) > Date.parse(best.updatedAt)
					? task
					: best,
			undefined,
		);
	const card =
		newest(
			numbered.filter(
				(task) =>
					!task.archivedAt &&
					task.status !== "completed" &&
					!ENDED.has(task.status),
			),
		) ?? newest(numbered);
	return card ? formatFactoryId(card.factoryNumber) : undefined;
}

/**
 * Shown above the composer of an Ask Factory conversation: what the manager
 * can do and a few example prompts that fill the composer when clicked. The
 * card example names one of the user's real cards, or is left out.
 */
export function FactoryManagerNotice({
	onPickExample,
}: {
	onPickExample?: (prompt: string) => void;
}) {
	const { tasks } = useAgendaTasks(
		FACTORY_AGENDA_FILTERS,
		Boolean(onPickExample),
	);
	const examples = useMemo(
		() => FACTORY_MANAGER.examples(factoryManagerExampleCardId(tasks)),
		[tasks],
	);
	return (
		<div
			className="mx-auto mt-6 max-w-2xl px-4 text-center"
			data-factory-notice="manager"
		>
			<p className="flex items-center justify-center gap-2 text-sm font-semibold text-foreground">
				<span
					aria-hidden
					className="flex size-5 items-center justify-center rounded-md border bg-card text-foreground"
				>
					<MessageSquare className="size-3" />
				</span>
				{FACTORY_MANAGER.title}
			</p>
			<p className="mt-1 text-sm text-muted-foreground">
				{FACTORY_MANAGER.description}
			</p>
			{onPickExample ? (
				<ul
					aria-label={FACTORY_MANAGER.examplesLabel}
					className="mt-3 flex flex-wrap justify-center gap-2"
				>
					{examples.map((example) => (
						<li key={example}>
							<button
								type="button"
								className="rounded-full border bg-card px-3 py-1 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								onClick={() => onPickExample(example)}
							>
								{example}
							</button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
