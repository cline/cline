import { Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SideOpeningState } from "@/hooks/use-side-conversation";

export function SideConversationOpening({
	state,
	onHide,
	onRetry,
}: {
	state: Exclude<SideOpeningState, { kind: "idle" }>;
	onHide: () => void;
	onRetry: () => void;
}) {
	return (
		<div className="absolute inset-0 z-20 flex flex-col bg-background">
			<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
				{state.kind === "opening" ? (
					<>
						<Loader2 className="size-5 animate-spin" aria-hidden="true" />
						<output>Opening side chat…</output>
					</>
				) : (
					<>
						<output>Couldn’t open side chat</output>
						<p className="text-xs">{state.message}</p>
						<Button variant="outline" size="sm" onClick={onRetry}>
							Retry
						</Button>
					</>
				)}
				<Button variant="ghost" size="sm" onClick={onHide}>
					Hide side chat
				</Button>
			</div>
		</div>
	);
}

export function SideConversationEmpty() {
	return (
		<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center text-muted-foreground">
			<MessageSquare className="mb-2 size-6" aria-hidden="true" />
			<p className="text-sm font-medium">Side chat</p>
			<p className="text-xs">
				Ask a related question while the main chat continues. Side chats clear
				when you quit the app.
			</p>
		</div>
	);
}
