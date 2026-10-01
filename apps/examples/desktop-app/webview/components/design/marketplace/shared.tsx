"use client";

import {
	ArrowUpRight,
	BadgeCheck,
	Check,
	KeyRound,
	LogIn,
	Search,
	X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { type ItemKind, KIND_META, type MarketplaceItem } from "./data";

/** Brand logo when the catalog has one, otherwise the kind's glyph on its tint. */
export function ItemIcon({
	item,
	size = "md",
	className,
}: {
	item: MarketplaceItem;
	size?: "sm" | "md" | "lg";
	className?: string;
}) {
	const [failed, setFailed] = useState(false);
	const meta = KIND_META[item.kind];
	const Glyph = meta.icon;
	const box =
		size === "sm"
			? "size-7 rounded-md"
			: size === "lg"
				? "size-12 rounded-xl"
				: "size-9 rounded-lg";
	const glyph =
		size === "sm" ? "size-3.5" : size === "lg" ? "size-6" : "size-4.5";
	if (item.icon && !failed) {
		return (
			<span
				className={cn(
					"flex shrink-0 items-center justify-center overflow-hidden bg-white",
					box,
					className,
				)}
			>
				{/* biome-ignore lint/performance/noImgElement: remote marketplace logos */}
				<img
					alt=""
					className="size-full object-contain p-1"
					onError={() => setFailed(true)}
					src={item.icon}
				/>
			</span>
		);
	}
	return (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center",
				box,
				meta.bg,
				meta.text,
				className,
			)}
		>
			<Glyph className={glyph} />
		</span>
	);
}

export function KindPill({
	kind,
	className,
	short = false,
}: {
	kind: ItemKind;
	className?: string;
	short?: boolean;
}) {
	const meta = KIND_META[kind];
	const Glyph = meta.icon;
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
				meta.bg,
				meta.text,
				className,
			)}
		>
			<Glyph className="size-3" />
			{short && kind === "mcp" ? "MCP" : meta.label}
		</span>
	);
}

export function VerifiedMark({ className }: { className?: string }) {
	return (
		<BadgeCheck
			aria-label="Verified"
			className={cn("size-3.5 shrink-0 text-sky-500", className)}
		/>
	);
}

export function InstallButton({
	item,
	size = "xs",
	stopPropagation = true,
}: {
	item: MarketplaceItem;
	size?: "xs" | "sm";
	stopPropagation?: boolean;
}) {
	if (item.installed) {
		return (
			<Button
				className="text-muted-foreground"
				onClick={(event) => stopPropagation && event.stopPropagation()}
				size={size}
				type="button"
				variant="outline"
			>
				<Check className="size-3.5 text-emerald-500" />
				Installed
			</Button>
		);
	}
	return (
		<Button
			onClick={(event) => stopPropagation && event.stopPropagation()}
			size={size}
			type="button"
			variant={item.kind === "connector" ? "outline" : "default"}
		>
			{item.kind === "connector" ? (
				<>
					<LogIn className="size-3.5" />
					Connect
				</>
			) : (
				"Install"
			)}
		</Button>
	);
}

export function SearchField({
	value,
	onChange,
	placeholder = "Search skills, MCP servers, plugins, connectors",
	className,
	inputClassName,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	className?: string;
	inputClassName?: string;
}) {
	return (
		<div className={cn("relative", className)}>
			<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				aria-label="Search marketplace"
				className={cn("h-9 pl-8 pr-8", inputClassName)}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				value={value}
			/>
			{value ? (
				<button
					aria-label="Clear search"
					className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
					onClick={() => onChange("")}
					type="button"
				>
					<X className="size-3.5" />
				</button>
			) : null}
		</div>
	);
}

export function SetupHint({ item }: { item: MarketplaceItem }) {
	if (item.setup === "none") {
		return (
			<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
				<Check className="size-3 text-emerald-500" />
				{item.kind === "mcp" ? "No API key" : "No setup"}
			</span>
		);
	}
	if (item.setup === "oauth") {
		return (
			<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
				<LogIn className="size-3" />
				Sign in with {item.name}
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-300">
			<KeyRound className="size-3" />
			Needs API key
		</span>
	);
}

/** Right-hand detail panel shared by the master/detail variations. */
export function DetailPanel({
	item,
	onClose,
	children,
	className,
	headerExtra,
	hideKind = false,
	hideClose = false,
}: {
	item: MarketplaceItem;
	onClose: () => void;
	children?: ReactNode;
	className?: string;
	/** Replaces the kind pill in the title row. */
	headerExtra?: ReactNode;
	/** Hides the install row and kind explainer (for multi-option services). */
	hideKind?: boolean;
	/** For hosts (sheets) that already render their own close control. */
	hideClose?: boolean;
}) {
	const meta = KIND_META[item.kind];
	return (
		<ScrollArea className={cn("h-full min-w-0 flex-1", className)}>
			<div className="mx-auto grid max-w-2xl gap-6 px-8 py-8">
				<div className="flex items-start gap-4">
					<ItemIcon item={item} size="lg" />
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="truncate text-xl font-semibold text-foreground">
								{item.name}
							</h1>
							{item.verified ? <VerifiedMark className="size-4" /> : null}
							{headerExtra ?? (hideKind ? null : <KindPill kind={item.kind} />)}
						</div>
						<p className="mt-1 text-sm text-muted-foreground">{item.tagline}</p>
						{item.author ? (
							<p className="mt-1 text-xs text-muted-foreground">
								by {item.author}
							</p>
						) : null}
					</div>
					{hideClose ? null : (
						<Button
							aria-label="Close details"
							className="shrink-0 text-muted-foreground"
							onClick={onClose}
							size="icon"
							type="button"
							variant="ghost"
						>
							<X className="size-4" />
						</Button>
					)}
				</div>

				{hideKind ? null : (
					<>
						<div className="flex flex-wrap items-center gap-2">
							<InstallButton item={item} size="sm" stopPropagation={false} />
							{item.homepage ? (
								<Button size="sm" type="button" variant="outline">
									Learn more
									<ArrowUpRight className="size-3.5 text-muted-foreground" />
								</Button>
							) : null}
							<span className="ml-1">
								<SetupHint item={item} />
							</span>
						</div>

						<div
							className={cn(
								"flex items-start gap-3 rounded-lg p-3 text-xs ring-1 ring-inset",
								meta.bg,
								meta.ring,
							)}
						>
							<meta.icon className={cn("mt-0.5 size-4 shrink-0", meta.text)} />
							<p className="text-foreground/80">
								<span className={cn("font-medium", meta.text)}>
									{meta.label}.
								</span>{" "}
								{meta.blurb}
							</p>
						</div>
					</>
				)}

				{children}

				<section className="grid gap-2">
					<h2 className="text-sm font-semibold text-foreground">About</h2>
					<p className="text-sm leading-6 text-muted-foreground">
						{item.description}
					</p>
					{item.categories.length > 0 ? (
						<div className="mt-1 flex flex-wrap gap-1.5">
							{item.categories.map((category) => (
								<Badge
									className="text-muted-foreground"
									key={category}
									variant="outline"
								>
									{category}
								</Badge>
							))}
						</div>
					) : null}
				</section>

				{typeof item.toolsCount === "number" ? (
					<section className="grid gap-1">
						<h2 className="text-sm font-semibold text-foreground">Tools</h2>
						<p className="text-sm text-muted-foreground">
							{item.toolsCount} tools available in new sessions once connected.
						</p>
					</section>
				) : null}
			</div>
		</ScrollArea>
	);
}

export function EmptyState({ query }: { query: string }) {
	return (
		<p className="px-3 py-10 text-center text-sm text-muted-foreground">
			{query ? `Nothing matches "${query.trim()}".` : "Nothing here yet."}
		</p>
	);
}

export function KindLegend({ className }: { className?: string }) {
	return (
		<div
			className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}
		>
			{(Object.keys(KIND_META) as ItemKind[]).map((kind) => {
				const meta = KIND_META[kind];
				return (
					<span
						className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
						key={kind}
					>
						<span className={cn("size-1.5 rounded-full", meta.dot)} />
						{meta.label}
					</span>
				);
			})}
		</div>
	);
}
