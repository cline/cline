import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	Check,
	CircleCheck,
	CircleX,
	FolderOpen,
	GitBranch,
	GitPullRequest,
	Info,
	LockKeyhole,
	Plus,
	RotateCcw,
	Sparkles,
	Tag,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { fn } from "storybook/test";
import {
	Badge,
	type BadgeProps,
	type InteractiveBadgeProps,
} from "../components/badge";

const TONES = [
	"neutral",
	"accent",
	"info",
	"success",
	"warning",
	"error",
] as const;
const LEADING_ICON_EXAMPLES = {
	neutral: { icon: GitBranch, label: "main" },
	accent: { icon: Sparkles, label: "New feature" },
	info: { icon: GitPullRequest, label: "In review" },
	success: { icon: CircleCheck, label: "Connected" },
	warning: { icon: TriangleAlert, label: "Needs attention" },
	error: { icon: CircleX, label: "Failed" },
};

const CLICKABLE_EXAMPLES = {
	neutral: { icon: FolderOpen, label: "View files" },
	accent: { icon: Plus, label: "New task" },
	info: { icon: Info, label: "View details" },
	success: { icon: Check, label: "Approve" },
	warning: { icon: TriangleAlert, label: "Review issues" },
	error: { icon: RotateCcw, label: "Retry" },
};

const meta: Meta<typeof Badge> = {
	title: "Components/Badge",
	component: Badge,
	tags: ["autodocs", "!dev"],
	parameters: {
		docs: {
			description: {
				component:
					'Place an SVG icon before the label to add a leading icon. Icons scale with the badge size; mark decorative icons with aria-hidden="true".\n\n' +
					'Set `variant="ghost"` for a transparent badge in any color tone. The default `soft` variant keeps the tinted background and border.\n\n' +
					'Set `interactive` to render a native button (default `type="button"`). Without it, Badge stays a span, including when it has an `onClick` handler. Interactive badges share Button’s focus ring, disabled state, and press animation. Use `disabled` to prevent activation and `pressScale={false}` to disable scaling; reduced-motion preferences also suppress scaling.',
			},
		},
	},
	argTypes: {
		interactive: {
			control: "boolean",
		},
		variant: {
			control: "select",
			options: ["soft", "ghost"],
		},
		onClick: {
			control: false,
		},
		disabled: {
			control: false,
		},
		size: {
			control: "select",
			options: ["xxs", "xs", "sm"],
		},
		tone: {
			control: "select",
			options: TONES,
		},
	},
	args: {
		variant: "soft",
		children: "Required",
		size: "xs",
		tone: "neutral",
	},
};

export default meta;

type Story = StoryObj<BadgeProps>;

// Keep the interactive preview above the controls without repeating it below.
export const Default: Story = {
	tags: ["!autodocs"],
};

export const Colors: Story = {
	render: (args: BadgeProps) => (
		<div className="flex flex-wrap items-start gap-4 p-4">
			{TONES.map((tone) => (
				<div className="flex flex-col items-start gap-2" key={tone}>
					<span className="text-cline-ui-muted-foreground text-cline-ui-xs">
						{tone}
					</span>
					<Badge {...args} tone={tone} />
				</div>
			))}
		</div>
	),
};

export const Sizes: Story = {
	render: (args: BadgeProps) => (
		<div className="flex flex-wrap items-start gap-4 p-4">
			{(["xxs", "xs", "sm"] as const).map((size) => (
				<div className="flex flex-col items-start gap-2" key={size}>
					<span className="text-cline-ui-muted-foreground text-cline-ui-xs">
						{size}
					</span>
					<Badge {...args} size={size} />
					<Badge {...args} size={size}>
						<Tag aria-hidden="true" />
						{args.children}
					</Badge>
				</div>
			))}
		</div>
	),
};

export const WithLeadingIcons: Story = {
	render: (args: BadgeProps) => (
		<div className="flex flex-wrap items-start gap-4 p-4">
			{TONES.map((tone) => {
				const { icon: Icon, label } = LEADING_ICON_EXAMPLES[tone];
				return (
					<div className="flex flex-col items-start gap-2" key={tone}>
						<span className="text-cline-ui-muted-foreground text-cline-ui-xs">
							{tone}
						</span>
						<Badge {...args} tone={tone}>
							<Icon aria-hidden="true" />
							{label}
						</Badge>
					</div>
				);
			})}
		</div>
	),
};

export const Ghost: Story = {
	...WithLeadingIcons,
	args: { variant: "ghost" },
};

export const Clickable: StoryObj<InteractiveBadgeProps> = {
	args: { interactive: true, onClick: fn() },
	render: function ClickableExample(args: InteractiveBadgeProps) {
		const [lastAction, setLastAction] = useState<string>();
		return (
			<div className="space-y-4 p-4">
				<div className="flex flex-wrap items-start gap-4">
					{TONES.map((tone) => {
						const { icon: Icon, label } = CLICKABLE_EXAMPLES[tone];
						return (
							<div className="flex flex-col items-start gap-2" key={tone}>
								<span className="text-cline-ui-muted-foreground text-cline-ui-xs">
									{tone}
								</span>
								<Badge
									{...args}
									interactive
									onClick={(event) => {
										setLastAction(label);
										args.onClick?.(event);
									}}
									tone={tone}
								>
									<Icon aria-hidden="true" />
									{label}
								</Badge>
							</div>
						);
					})}
					<div className="flex flex-col items-start gap-2">
						<span className="text-cline-ui-muted-foreground text-cline-ui-xs">
							disabled
						</span>
						<Badge
							interactive
							variant={args.variant}
							disabled
							onClick={(event) => args.onClick?.(event)}
							size={args.size}
						>
							<LockKeyhole aria-hidden="true" />
							Open workspace
						</Badge>
					</div>
				</div>
				<output className="block text-cline-ui-muted-foreground text-cline-ui-sm">
					{lastAction
						? `Last action: ${lastAction}`
						: "Click a badge to try an action."}
				</output>
			</div>
		);
	},
};

export const ClickableGhost: StoryObj<InteractiveBadgeProps> = {
	...Clickable,
	args: { ...Clickable.args, variant: "ghost" },
};
