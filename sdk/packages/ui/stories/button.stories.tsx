import type { Meta } from "@storybook/react-vite";
import { Fragment } from "react";
import { Button, type ButtonTone, IconButton } from "../components/button";

const meta: Meta = {
	title: "Components/Button",
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Two components — `Button` (text, with optional icon children) and `IconButton` (square, icon-only) — sharing the same `variant × tone × size` design tokens.\n\n" +
					"**variant** `fill | surface | ghost` — fill is solid-colored, surface has a soft tinted background, ghost only shows a background on hover.\n\n" +
					"**tone** `accent | neutral | destructive` — applies to all three variants.\n\n" +
					"**size** `xs | sm | md | lg` — same names for both Button and IconButton.",
			},
		},
	},
};

export default meta;

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const VARIANTS = ["fill", "surface", "ghost"] as const;
const TONES = ["accent", "neutral", "destructive"] as const;
const SIZES = ["xs", "sm", "md", "lg"] as const;

function PlusIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth={2}
			viewBox="0 0 24 24"
		>
			<path d="M12 5v14M5 12h14" />
		</svg>
	);
}

function ChevronIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth={2}
			viewBox="0 0 24 24"
		>
			<path d="M6 9l6 6 6-6" />
		</svg>
	);
}

function TrashIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={2}
			viewBox="0 0 24 24"
		>
			<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
		</svg>
	);
}

// ─── Stories ──────────────────────────────────────────────────────────────────

export const VariantMatrix = () => (
	<div className="space-y-8 p-8">
		<div>
			<h2 className="mb-4 text-sm font-semibold">Button — variant × tone</h2>
			<div
				className="grid gap-3"
				style={{ gridTemplateColumns: "auto repeat(3, auto)" }}
			>
				<div />
				{VARIANTS.map((v) => (
					<span
						className="px-2 text-xs font-medium text-muted-foreground"
						key={v}
					>
						{v}
					</span>
				))}
				{TONES.map((tone) => (
					<Fragment key={tone}>
						<span className="flex items-center pr-4 text-xs font-medium text-muted-foreground">
							{tone}
						</span>
						{VARIANTS.map((variant) => (
							<div className="flex" key={variant}>
								<Button tone={tone} variant={variant}>
									Button
								</Button>
							</div>
						))}
					</Fragment>
				))}
			</div>
		</div>

		<div>
			<h2 className="mb-4 text-sm font-semibold">
				IconButton — variant × tone
			</h2>
			<div
				className="grid gap-3"
				style={{ gridTemplateColumns: "auto repeat(3, auto)" }}
			>
				<div />
				{VARIANTS.map((v) => (
					<span
						className="px-2 text-xs font-medium text-muted-foreground"
						key={v}
					>
						{v}
					</span>
				))}
				{TONES.map((tone) => (
					<Fragment key={tone}>
						<span className="flex items-center pr-4 text-xs font-medium text-muted-foreground">
							{tone}
						</span>
						{VARIANTS.map((variant) => (
							<div className="flex" key={variant}>
								<IconButton
									aria-label={`${variant} ${tone}`}
									tone={tone}
									variant={variant}
								>
									<PlusIcon />
								</IconButton>
							</div>
						))}
					</Fragment>
				))}
			</div>
		</div>
	</div>
);

export const Sizes = () => (
	<div className="space-y-8 p-8">
		<div>
			<h2 className="mb-4 text-sm font-semibold">Button sizes</h2>
			<div className="flex flex-wrap items-end gap-3">
				{SIZES.map((size) => (
					<Button key={size} size={size} tone="accent" variant="fill">
						{size}
					</Button>
				))}
			</div>
		</div>

		<div>
			<h2 className="mb-4 text-sm font-semibold">
				IconButton sizes (same tokens)
			</h2>
			<div className="flex flex-wrap items-end gap-3">
				{SIZES.map((size) => (
					<IconButton
						aria-label={size}
						key={size}
						size={size}
						tone="accent"
						variant="fill"
					>
						<PlusIcon />
					</IconButton>
				))}
			</div>
		</div>
	</div>
);

export const WithIcons = () => (
	<div className="space-y-4 p-8">
		<h2 className="text-sm font-semibold">
			Button — with leading and trailing icons
		</h2>
		<div className="flex flex-wrap items-center gap-3">
			<Button tone="accent" variant="fill">
				<PlusIcon />
				New session
			</Button>
			<Button tone="accent" variant="surface">
				<PlusIcon />
				New session
			</Button>
			<Button tone="neutral" variant="ghost">
				More options
				<ChevronIcon />
			</Button>
			<Button tone="destructive" variant="fill">
				<TrashIcon />
				Delete
			</Button>
			<Button tone="destructive" variant="surface">
				<TrashIcon />
				Delete
			</Button>
			<Button tone="destructive" variant="ghost">
				<TrashIcon />
				Remove
			</Button>
		</div>
	</div>
);

export const Disabled = () => (
	<div className="space-y-4 p-8">
		<h2 className="text-sm font-semibold">Disabled state</h2>
		<div className="flex flex-wrap items-center gap-3">
			{(["fill", "surface", "ghost"] as const).map((variant) => (
				<Button disabled key={variant} tone="accent" variant={variant}>
					Button
				</Button>
			))}
			{(["fill", "surface", "ghost"] as const).map((variant) => (
				<IconButton
					aria-label="disabled"
					disabled
					key={variant}
					tone="accent"
					variant={variant}
				>
					<PlusIcon />
				</IconButton>
			))}
		</div>
	</div>
);

export const AccentTone = () => <ToneShowcase label="accent" tone="accent" />;

export const NeutralTone = () => (
	<ToneShowcase label="neutral" tone="neutral" />
);

export const DestructiveTone = () => (
	<ToneShowcase label="destructive" tone="destructive" />
);

function ToneShowcase({ label, tone }: { label: string; tone: ButtonTone }) {
	return (
		<div className="space-y-6 p-8">
			<h2 className="text-sm font-semibold">tone="{label}"</h2>
			<div className="space-y-4">
				{VARIANTS.map((variant) => (
					<div className="flex items-center gap-6" key={variant}>
						<span className="w-16 text-xs text-muted-foreground">
							{variant}
						</span>
						<div className="flex items-center gap-3">
							{SIZES.map((size) => (
								<Button key={size} size={size} tone={tone} variant={variant}>
									Button
								</Button>
							))}
						</div>
						<div className="flex items-center gap-2">
							{SIZES.map((size) => (
								<IconButton
									aria-label={size}
									key={size}
									size={size}
									tone={tone}
									variant={variant}
								>
									<PlusIcon />
								</IconButton>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
