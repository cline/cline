import type { BankSnapshot } from "@cline/shared";
import { cn } from "@/lib/utils";
import { shouldShowNowNext } from "./nowNextLogic";

export type NowNextProps = {
	snapshot: BankSnapshot;
	onSelectNow?: (taskId: string) => void;
	onSelectNext?: (taskId: string) => void;
	className?: string;
};

export { shouldShowNowNext } from "./nowNextLogic";

export function NowNext({
	snapshot,
	onSelectNow,
	onSelectNext,
	className,
}: NowNextProps) {
	if (!shouldShowNowNext(snapshot)) {
		return null;
	}

	return (
		<div
			className={cn(
				"flex flex-wrap items-stretch gap-2 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2",
				className,
			)}
			data-slot="now-next"
		>
			<button
				className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-left hover:bg-muted/60"
				onClick={() => {
					if (snapshot.nowTaskId) {
						onSelectNow?.(snapshot.nowTaskId);
					}
				}}
				type="button"
			>
				<div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
					now
				</div>
				<div className="truncate text-xs font-medium">
					{snapshot.nowTitle ?? snapshot.nowTaskId}
				</div>
			</button>
			<button
				className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-left hover:bg-muted/60 disabled:opacity-50"
				disabled={!snapshot.nextTaskId}
				onClick={() => {
					if (snapshot.nextTaskId) {
						onSelectNext?.(snapshot.nextTaskId);
					}
				}}
				type="button"
			>
				<div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
					next
				</div>
				<div className="truncate text-xs">
					{snapshot.nextTitle ?? snapshot.nextTaskId ?? "—"}
				</div>
			</button>
		</div>
	);
}
