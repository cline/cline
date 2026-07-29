import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RouteSuggestion } from "./routeSuggest";

export function RouteSuggestChip({
	suggestion,
	onAccept,
	onDismiss,
	className,
}: {
	suggestion: RouteSuggestion;
	onAccept: () => void;
	onDismiss: () => void;
	className?: string;
}) {
	return (
		<div
			aria-label="Route suggestion"
			className={cn(
				"flex flex-wrap items-center gap-2 border-t border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs",
				className,
			)}
			data-testid="drive-route-suggest"
		>
			<span className="font-medium text-foreground">
				Route to {suggestion.displayName}
			</span>
			<span className="text-muted-foreground">
				score {suggestion.score.toFixed(1)}
				{suggestion.reasons[0] ? ` · ${suggestion.reasons[0]}` : ""}
			</span>
			<div className="ml-auto flex gap-1">
				<Button
					data-testid="drive-route-accept"
					onClick={onAccept}
					size="sm"
					type="button"
					variant="default"
				>
					Accept
				</Button>
				<Button
					data-testid="drive-route-dismiss"
					onClick={onDismiss}
					size="sm"
					type="button"
					variant="ghost"
				>
					Skip
				</Button>
			</div>
		</div>
	);
}
