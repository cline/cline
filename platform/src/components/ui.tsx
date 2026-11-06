import type { LucideIcon } from "lucide-react";
import { cn, humanizeStatus, statusTone } from "@/lib/utils";

const toneClasses: Record<string, string> = {
	success: "border-signal-500/25 bg-signal-500/10 text-signal-300",
	danger: "border-rose-400/25 bg-rose-400/10 text-rose-400",
	warning: "border-amber-400/25 bg-amber-400/10 text-amber-400",
	info: "border-iris-400/25 bg-iris-400/10 text-iris-400",
	muted: "border-white/10 bg-white/5 text-mist-400",
};

export function Badge({
	children,
	tone = "muted",
	className,
	dot,
}: {
	children: React.ReactNode;
	tone?: keyof typeof toneClasses;
	className?: string;
	dot?: boolean;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium",
				toneClasses[tone],
				className,
			)}
		>
			{dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
			{children}
		</span>
	);
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
	const tone = statusTone(status);
	const live = ["queued", "provisioning", "running", "waiting_approval"].includes(status);
	return (
		<Badge tone={tone} className={className} dot>
			<span className={live ? "animate-pulse-soft capitalize" : "capitalize"}>
				{humanizeStatus(status)}
			</span>
		</Badge>
	);
}

export function Panel({
	children,
	className,
	as: Tag = "section",
}: {
	children: React.ReactNode;
	className?: string;
	as?: "section" | "div" | "article" | "aside";
}) {
	return <Tag className={cn("surface", className)}>{children}</Tag>;
}

export function SectionHeading({
	title,
	description,
	action,
	className,
}: {
	title: string;
	description?: string;
	action?: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
			<div>
				<h2 className="font-display text-lg font-semibold tracking-tight text-mist-50">{title}</h2>
				{description ? <p className="mt-1 text-[0.8125rem] text-mist-500">{description}</p> : null}
			</div>
			{action}
		</div>
	);
}

export function Stat({
	label,
	value,
	detail,
	icon: Icon,
	accent,
}: {
	label: string;
	value: React.ReactNode;
	detail?: React.ReactNode;
	icon?: LucideIcon;
	accent?: "signal" | "mint" | "iris" | "plain";
}) {
	const accents = {
		signal: "text-signal-300 bg-signal-500/10 border-signal-500/20",
		mint: "text-mint-400 bg-mint-400/10 border-mint-400/20",
		iris: "text-iris-400 bg-iris-400/10 border-iris-400/20",
		plain: "text-mist-300 bg-white/5 border-white/10",
	};
	return (
		<div className="surface flex flex-col gap-4 p-5">
			<div className="flex items-start justify-between gap-3">
				<p className="eyebrow">{label}</p>
				{Icon ? (
					<span
						className={cn(
							"grid size-7 place-items-center rounded-lg border",
							accents[accent ?? "plain"],
						)}
					>
						<Icon className="size-3.5" strokeWidth={1.8} />
					</span>
				) : null}
			</div>
			<div>
				<p className="font-display text-[1.9rem] font-semibold leading-none tracking-tight text-mist-50">
					{value}
				</p>
				{detail ? <div className="mt-2 text-xs text-mist-500">{detail}</div> : null}
			</div>
		</div>
	);
}

export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	className,
}: {
	icon: LucideIcon;
	title: string;
	description: string;
	action?: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-14 text-center",
				className,
			)}
		>
			<span className="grid size-11 place-items-center rounded-xl border border-white/10 bg-white/5 text-mist-400">
				<Icon className="size-5" strokeWidth={1.7} />
			</span>
			<div>
				<p className="font-display text-sm font-semibold text-mist-100">{title}</p>
				<p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-mist-500">{description}</p>
			</div>
			{action ? <div className="mt-1">{action}</div> : null}
		</div>
	);
}

export function InlineAlert({
	tone = "danger",
	title,
	children,
	className,
}: {
	tone?: "danger" | "warning" | "info" | "success";
	title?: string;
	children: React.ReactNode;
	className?: string;
}) {
	const tones = {
		danger: "border-rose-400/20 bg-rose-400/[0.06] text-rose-200",
		warning: "border-amber-400/20 bg-amber-400/[0.06] text-amber-200",
		info: "border-iris-400/20 bg-iris-400/[0.06] text-iris-200",
		success: "border-signal-500/20 bg-signal-500/[0.06] text-signal-200",
	};
	return (
		<div
			className={cn("rounded-xl border px-4 py-3 text-xs leading-relaxed", tones[tone], className)}
		>
			{title ? <p className="mb-0.5 font-semibold">{title}</p> : null}
			{children}
		</div>
	);
}

export function Divider({ className }: { className?: string }) {
	return <div className={cn("h-px w-full bg-white/[0.07]", className)} />;
}
