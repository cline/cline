import { BadgeCheck, Check, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Presentation for one marketplace primitive type (skill, MCP, ...). */
export type MarketplaceTypeMeta = {
	label: string;
	plural: string;
	/** Short pill label where space is tight ("MCP" instead of "MCP server"). */
	short: string;
	icon: LucideIcon;
	/** One-line answer to "what is this and what does adding it involve". */
	blurb: string;
	/** Tailwind tint classes so each type reads the same everywhere. */
	text: string;
	bg: string;
};

/** The type's glyph on its tint; every row gets one so rows look alike. */
export function MarketplaceTypeGlyph({
	meta,
	className,
}: {
	meta: MarketplaceTypeMeta;
	className?: string;
}) {
	const Icon = meta.icon;
	return (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center rounded-md",
				meta.bg,
				meta.text,
				className,
			)}
		>
			<Icon className="size-[55%]" />
		</span>
	);
}

export function MarketplaceTypePill({ meta }: { meta: MarketplaceTypeMeta }) {
	const Icon = meta.icon;
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
				meta.bg,
				meta.text,
			)}
		>
			<Icon className="size-3" />
			{meta.short}
		</span>
	);
}

export function MarketplaceListRow({
	name,
	description,
	meta,
	glyph,
	showType = false,
	verified = false,
	installed,
	onSelect,
	selected,
}: {
	name: string;
	description?: string;
	meta: MarketplaceTypeMeta;
	/** Replaces the type glyph when the entry has its own mark (a connector's
	 * brand logo). Sized by the caller to match `size-7`. */
	glyph?: ReactNode;
	/** Show the type pill (useful when rows of mixed types sit together). */
	showType?: boolean;
	verified?: boolean;
	installed: boolean;
	onSelect: () => void;
	selected: boolean;
}) {
	return (
		<button
			className={cn(
				"flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
				selected ? "bg-primary/10" : "hover:bg-surface-hover-lighter",
			)}
			onClick={onSelect}
			type="button"
		>
			{glyph ?? <MarketplaceTypeGlyph className="size-7" meta={meta} />}
			<span className="min-w-0 flex-1">
				<span className="flex min-w-0 items-center gap-1.5">
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
			{showType ? <MarketplaceTypePill meta={meta} /> : null}
			{installed ? (
				<Check
					aria-label="Installed"
					className="size-3.5 shrink-0 text-emerald-500"
				/>
			) : null}
		</button>
	);
}
