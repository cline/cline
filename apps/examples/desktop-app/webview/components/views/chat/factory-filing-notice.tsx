"use client";

import type {
	HubFactoryDuplicateOf,
	HubFactoryRelatedCard,
} from "@cline/shared";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/lib/chat-schema";
import { FACTORY_DUPLICATES } from "@/lib/factory-copy";

/** The `factory` tool's name, as Ask Factory files cards with it. */
const FACTORY_TOOL = "factory";

/**
 * What the last filing of the current turn came to, in Ask Factory or an Add
 * work chat: blocked because another card already covers it, or created and
 * linked to related cards. Undefined for anything else (no filing since the
 * person's last message, a plain filing, a failure).
 */
export type FactoryFiling =
	| { kind: "duplicate"; card: HubFactoryDuplicateOf }
	| { kind: "related"; cards: HubFactoryRelatedCard[] };

export function latestFactoryFiling(
	messages: readonly ChatMessage[],
): FactoryFiling | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role === "user") return undefined;
		if (message?.role !== "tool") continue;
		let payload: { toolName?: string; result?: unknown } | undefined;
		try {
			payload = JSON.parse(message.content);
		} catch {
			continue;
		}
		if (payload?.toolName !== FACTORY_TOOL) continue;
		let result = payload.result;
		if (typeof result === "string") {
			try {
				result = JSON.parse(result);
			} catch {
				return undefined;
			}
		}
		const reply = result as {
			ok?: boolean;
			duplicateOf?: HubFactoryDuplicateOf;
			relatedTo?: HubFactoryRelatedCard[];
		} | null;
		if (!reply?.ok) return undefined;
		if (reply.duplicateOf?.taskId)
			return { kind: "duplicate", card: reply.duplicateOf };
		if (reply.relatedTo?.length)
			return { kind: "related", cards: reply.relatedTo };
		return undefined;
	}
	return undefined;
}

const name = (card: { factoryId?: string; title: string }) =>
	card.factoryId ?? card.title;

/**
 * Above the composer after a filing: "F12 already covers this — it is in
 * Review." with Open F12 and File anyway (the chat asks Factory to file it
 * with the duplicate check skipped), or a note naming the related cards a
 * new card was linked to.
 */
export function FactoryFilingNotice({
	filing,
	busy,
	onOpenCard,
	onFileAnyway,
}: {
	filing: FactoryFiling;
	/** The chat is still answering: File anyway waits. */
	busy: boolean;
	onOpenCard: (taskId: string) => void;
	onFileAnyway: () => void;
}) {
	if (filing.kind === "related")
		return (
			<p
				data-factory-filing="related"
				className="mb-2 px-1 text-xs text-muted-foreground"
			>
				{FACTORY_DUPLICATES.related}{" "}
				{filing.cards.map((card, index) => (
					<span key={card.taskId}>
						{index > 0 ? ", " : null}
						<button
							type="button"
							title={card.title}
							className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onClick={() => onOpenCard(card.taskId)}
						>
							{name(card)}
						</button>
					</span>
				))}
			</p>
		);
	const { card } = filing;
	return (
		<output
			data-factory-filing="duplicate"
			className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2 text-sm"
		>
			<span className="min-w-0 flex-1">
				{FACTORY_DUPLICATES.covers(name(card), card.state)}
			</span>
			<span className="flex shrink-0 items-center gap-1.5">
				<Button
					size="sm"
					variant="outline"
					className="h-7"
					onClick={() => onOpenCard(card.taskId)}
				>
					{FACTORY_DUPLICATES.open(name(card))}
				</Button>
				<Button
					size="sm"
					variant="ghost"
					className="h-7"
					disabled={busy}
					onClick={onFileAnyway}
				>
					{FACTORY_DUPLICATES.fileAnyway}
				</Button>
			</span>
		</output>
	);
}
