"use client";

import { CheckCircle2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import type { BotSummary } from "@/hooks/use-bots";
import { basenamePath } from "@/hooks/use-session-history";

/**
 * Renders a `propose_new_bot` tool call as a review card instead of the
 * generic tool-activity view (see ToolCallRow's special case). The agent
 * only ever proposes - actual creation still goes through the same
 * `createBot` the sidebar's bot switcher uses, triggered here by the user's
 * own click. There's no result round-trip back to the agent; a card that's
 * never acted on just stays in the transcript, like any other tool call.
 */
export function ProposeNewBotCard({
	name,
	initialProjectPath,
	reason,
	onCreateBot,
}: {
	name: string;
	initialProjectPath?: string;
	reason?: string;
	onCreateBot: (
		name: string,
		initialProjectPath?: string,
		icon?: string,
	) => Promise<BotSummary>;
}) {
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [created, setCreated] = useState<BotSummary | null>(null);

	const handleCreate = useCallback(async () => {
		setIsCreating(true);
		setError(null);
		try {
			const result = await onCreateBot(name, initialProjectPath);
			setCreated(result);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Could not create the new bot.",
			);
		} finally {
			setIsCreating(false);
		}
	}, [name, initialProjectPath, onCreateBot]);

	return (
		<div className="flex flex-col gap-2 rounded-md border border-border bg-surface-secondary p-3 text-sm">
			<div className="font-medium">Proposed new bot: {name}</div>
			{reason ? <p className="text-muted-foreground">{reason}</p> : null}
			{initialProjectPath ? (
				<p className="text-xs text-muted-foreground">
					Opens into: {basenamePath(initialProjectPath)}
				</p>
			) : null}
			{created ? (
				<div className="flex items-center gap-1.5 text-emerald-500">
					<CheckCircle2 className="size-4" />
					<span>Created "{created.name}" and switched to it.</span>
				</div>
			) : (
				<div className="flex items-center gap-2">
					<Button
						disabled={isCreating}
						onClick={() => void handleCreate()}
						size="sm"
						type="button"
					>
						{isCreating ? "Creating…" : "Create this bot"}
					</Button>
					{error ? <p className="text-sm text-destructive">{error}</p> : null}
				</div>
			)}
		</div>
	);
}
