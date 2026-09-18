import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function MarketplaceListRow({
	name,
	description,
	verified = false,
	installed,
	onSelect,
	selected,
}: {
	name: string;
	description?: string;
	verified?: boolean;
	installed: boolean;
	onSelect: () => void;
	selected: boolean;
}) {
	return (
		<button
			className={cn(
				"flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
				selected ? "bg-primary/10" : "hover:bg-surface-hover-lighter",
			)}
			onClick={onSelect}
			type="button"
		>
			<span className="min-w-0 flex-1">
				<span className="flex min-w-0 items-center gap-1">
					<span className="truncate text-sm font-medium text-foreground">
						{name}
					</span>
					{verified ? (
						<BadgeCheck className="size-3.5 shrink-0 text-sky-500" />
					) : null}
				</span>
				<span className="block truncate text-xs text-muted-foreground">
					{description}
				</span>
			</span>
			{installed ? (
				<span
					className="size-1.5 shrink-0 rounded-full bg-emerald-500"
					title="Installed"
				/>
			) : null}
		</button>
	);
}
