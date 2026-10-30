import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	ChevronDown as ChevronIcon,
	Plus as PlusIcon,
	Trash2 as TrashIcon,
} from "lucide-react";
import { Fragment, type SVGProps } from "react";
import { fn } from "storybook/test";
import { Button, type ButtonTone, IconButton } from "../components/button";

const meta: Meta<typeof Button> = {
	title: "Components/Button",
	component: Button,
	tags: ["autodocs"],
	parameters: {
		controls: { disable: true },
		docs: {
			description: {
				component:
					"Two components — `Button` (text, with optional leading/trailing icons) and `IconButton` (square, icon-only) — sharing the same `variant × tone × size` design tokens.\n\n" +
					"**variant** `primary | secondary | ghost` — primary emphasizes the main action, secondary has a soft background, and ghost only shows a background on hover.\n\n" +
					"**tone** `accent | neutral | destructive` — applies to all three variants.\n\n" +
					"Primary neutral is dark with light text in light mode and light with dark text in dark mode. Secondary neutral keeps a visible gray background in both themes.\n\n" +
					"Button defaults to primary/accent/md; IconButton defaults to ghost/neutral/sm.\n\n" +
					"**size** `xs | sm | md | lg` — same names for both Button and IconButton.\n\n" +
					"**icons** Pass SVG components through `leadingIcon` / `trailingIcon` on Button or `icon` on IconButton. Managed icons inherit dimensions, spacing, and decorative accessibility. Both components also accept existing SVG children; IconButton always requires an accessible label.\n\n" +
					"**pressScale** defaults to `0.98`. Set `false` to disable press scaling or a number to customize it. Disabled controls and reduced-motion preferences suppress the effect.",
			},
		},
	},
	argTypes: {
		variant: { control: "select", options: ["primary", "secondary", "ghost"] },
		tone: { control: "select", options: ["accent", "neutral", "destructive"] },
		size: { control: "select", options: ["xs", "sm", "md", "lg"] },
		leadingIcon: {
			control: "select",
			options: ["None", "Plus", "Trash"],
			mapping: { None: undefined, Plus: PlusIcon, Trash: TrashIcon },
		},
		trailingIcon: {
			control: "select",
			options: ["None", "Chevron"],
			mapping: { None: undefined, Chevron: ChevronIcon },
		},
		pressScale: { control: "select", options: [0.98, 0.95, false] },
		asChild: { control: false },
		onClick: { control: false },
	},
};

export default meta;

type Story = StoryObj<typeof Button>;

export const Playground: Story = {
	parameters: { controls: { disable: false } },
	args: {
		children: "Continue",
		variant: "primary",
		tone: "accent",
		size: "md",
		disabled: false,
		pressScale: 0.98,
		onClick: fn(),
	},
	render: (args) => (
		<div className="p-8">
			<Button {...args} />
		</div>
	),
};

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const VARIANTS = ["primary", "secondary", "ghost"] as const;
const TONES = ["accent", "neutral", "destructive"] as const;
const SIZES = ["xs", "sm", "md", "lg"] as const;

function SparkIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			{...props}
		>
			<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z" />
		</svg>
	);
}

// ─── Stories ──────────────────────────────────────────────────────────────────

export const VariantMatrix = () => (
	<div className="space-y-8 p-8">
		<div>
			<h2 className="mb-4 font-semibold text-sm">Button — variant × tone</h2>
			<div
				className="grid gap-3"
				style={{ gridTemplateColumns: "auto repeat(3, auto)" }}
			>
				<div />
				{VARIANTS.map((v) => (
					<span
						className="px-2 font-medium text-muted-foreground text-xs"
						key={v}
					>
						{v}
					</span>
				))}
				{TONES.map((tone) => (
					<Fragment key={tone}>
						<span className="flex items-center pr-4 font-medium text-muted-foreground text-xs">
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
			<h2 className="mb-4 font-semibold text-sm">
				IconButton — variant × tone
			</h2>
			<div
				className="grid gap-3"
				style={{ gridTemplateColumns: "auto repeat(3, auto)" }}
			>
				<div />
				{VARIANTS.map((v) => (
					<span
						className="px-2 font-medium text-muted-foreground text-xs"
						key={v}
					>
						{v}
					</span>
				))}
				{TONES.map((tone) => (
					<Fragment key={tone}>
						<span className="flex items-center pr-4 font-medium text-muted-foreground text-xs">
							{tone}
						</span>
						{VARIANTS.map((variant) => (
							<div className="flex" key={variant}>
								<IconButton
									icon={PlusIcon}
									aria-label={`${variant} ${tone}`}
									tone={tone}
									variant={variant}
								/>
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
			<h2 className="mb-4 font-semibold text-sm">Button sizes</h2>
			<div className="flex flex-wrap items-end gap-3">
				{SIZES.map((size) => (
					<Button key={size} size={size} tone="accent" variant="primary">
						{size}
					</Button>
				))}
			</div>
		</div>

		<div>
			<h2 className="mb-4 font-semibold text-sm">
				IconButton sizes (same tokens)
			</h2>
			<div className="flex flex-wrap items-end gap-3">
				{SIZES.map((size) => (
					<IconButton
						icon={PlusIcon}
						aria-label={size}
						key={size}
						size={size}
						tone="accent"
						variant="primary"
					/>
				))}
			</div>
		</div>
	</div>
);

export const WithIcons = () => (
	<div className="space-y-4 p-8">
		<h2 className="font-semibold text-sm">
			Button — with leading and trailing icons
		</h2>
		<div className="flex flex-wrap items-center gap-3">
			<Button leadingIcon={PlusIcon} tone="accent" variant="primary">
				New session
			</Button>
			<Button leadingIcon={PlusIcon} tone="accent" variant="secondary">
				New session
			</Button>
			<Button trailingIcon={ChevronIcon} tone="neutral" variant="ghost">
				More options
			</Button>
			<Button leadingIcon={TrashIcon} tone="destructive" variant="primary">
				Delete
			</Button>
			<Button leadingIcon={TrashIcon} tone="destructive" variant="secondary">
				Delete
			</Button>
			<Button leadingIcon={TrashIcon} tone="destructive" variant="ghost">
				Remove
			</Button>
		</div>
	</div>
);

export const IconSpacing = () => (
	<div className="space-y-4 p-8">
		<h2 className="font-semibold text-sm">Button — icon spacing by size</h2>
		<p className="text-muted-foreground text-sm">
			Leading and trailing slots tighten only their respective side. Each icon
			uses the button size automatically.
		</p>
		<div
			className="grid items-center justify-items-start gap-4"
			style={{ gridTemplateColumns: "auto repeat(4, auto)" }}
		>
			<div />
			{["Text only", "Leading icon", "Trailing icon", "Both icons"].map(
				(label) => (
					<span className="text-muted-foreground text-xs" key={label}>
						{label}
					</span>
				),
			)}
			{SIZES.map((size) => (
				<Fragment key={size}>
					<span className="text-muted-foreground text-xs">{size}</span>
					<Button size={size} tone="neutral" variant="secondary">
						Button
					</Button>
					<Button
						leadingIcon={PlusIcon}
						size={size}
						tone="neutral"
						variant="secondary"
					>
						Button
					</Button>
					<Button
						trailingIcon={ChevronIcon}
						size={size}
						tone="neutral"
						variant="secondary"
					>
						Button
					</Button>
					<Button
						trailingIcon={ChevronIcon}
						leadingIcon={PlusIcon}
						size={size}
						tone="neutral"
						variant="secondary"
					>
						Button
					</Button>
				</Fragment>
			))}
		</div>
	</div>
);

export const PressFeedback = () => (
	<div className="space-y-6 p-8" id="press-feedback">
		<div className="space-y-2">
			<h2 className="font-semibold text-sm">Press feedback</h2>
			<p className="text-muted-foreground text-sm">
				Press and hold to compare. Scaling is disabled when reduced motion is
				preferred.
			</p>
		</div>
		<div className="flex flex-wrap items-center gap-4">
			<Button tone="neutral">Default (0.98)</Button>
			<Button pressScale={false} tone="neutral">
				No scaling
			</Button>
			<Button pressScale={0.95} tone="neutral">
				Custom (0.95)
			</Button>
			<Button disabled tone="neutral">
				Disabled
			</Button>
			<Button asChild tone="neutral" variant="secondary">
				<a href="#press-feedback" target="_self">
					As child link
				</a>
			</Button>
		</div>
		<div className="flex flex-wrap items-start gap-6">
			<div className="space-y-2">
				<p className="text-muted-foreground text-xs">Default (0.98)</p>
				<IconButton
					icon={PlusIcon}
					aria-label="Add with default scaling"
					variant="secondary"
				/>
			</div>
			<div className="space-y-2">
				<p className="text-muted-foreground text-xs">No scaling</p>
				<IconButton
					icon={PlusIcon}
					aria-label="Add without scaling"
					pressScale={false}
					variant="secondary"
				/>
			</div>
			<div className="space-y-2">
				<p className="text-muted-foreground text-xs">Custom (0.95)</p>
				<IconButton
					icon={PlusIcon}
					aria-label="Add with custom scaling"
					pressScale={0.95}
					variant="secondary"
				/>
			</div>
			<div className="space-y-2">
				<p className="text-muted-foreground text-xs">Disabled</p>
				<IconButton
					icon={PlusIcon}
					aria-label="Add disabled"
					disabled
					variant="secondary"
				/>
			</div>
		</div>
	</div>
);

export const Disabled = () => (
	<div className="space-y-4 p-8">
		<h2 className="font-semibold text-sm">Disabled state</h2>
		{TONES.map((tone) => (
			<div className="space-y-2" key={tone}>
				<h3 className="text-muted-foreground text-xs">{tone}</h3>
				<div className="flex flex-wrap items-center gap-3">
					{VARIANTS.map((variant) => (
						<Button disabled key={variant} tone={tone} variant={variant}>
							{variant}
						</Button>
					))}
					{VARIANTS.map((variant) => (
						<IconButton
							icon={PlusIcon}
							aria-label={`${variant} ${tone} disabled`}
							disabled
							key={variant}
							tone={tone}
							variant={variant}
						/>
					))}
				</div>
			</div>
		))}
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
			<h2 className="font-semibold text-sm">tone="{label}"</h2>
			<div className="space-y-4">
				{VARIANTS.map((variant) => (
					<div className="flex items-center gap-6" key={variant}>
						<span className="w-16 text-muted-foreground text-xs">
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
									icon={PlusIcon}
									aria-label={size}
									key={size}
									size={size}
									tone={tone}
									variant={variant}
								/>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

export const IconSlots = () => (
	<div className="space-y-6 p-8">
		<div className="space-y-2">
			<h2 className="font-semibold text-sm">Managed icon slots</h2>
			<p className="text-muted-foreground text-sm">
				Pass an SVG component. The button supplies its dimensions, spacing, and
				accessibility.
			</p>
		</div>
		<div className="flex flex-wrap items-center gap-3">
			<Button leadingIcon={PlusIcon}>New session</Button>
			<Button leadingIcon={SparkIcon} tone="neutral">
				Custom SVG
			</Button>
			<Button
				asChild
				trailingIcon={ChevronIcon}
				tone="neutral"
				variant="secondary"
			>
				<a href="#icon-slots" id="icon-slots">
					Composed link
				</a>
			</Button>
			<IconButton
				asChild
				icon={PlusIcon}
				aria-label="Create from link"
				variant="secondary"
			>
				{/* biome-ignore lint/a11y/useAnchorContent: IconButton supplies the accessible label and icon to this composed link. */}
				<a href="#icon-slots" />
			</IconButton>
			<Button
				leadingIcon={PlusIcon}
				className="[--cline-ui-button-icon-size:1.25rem]"
				variant="secondary"
			>
				Deliberate size override
			</Button>
		</div>
	</div>
);
