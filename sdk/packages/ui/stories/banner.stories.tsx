import type { Meta, StoryObj } from "@storybook/react-vite";
import { Info } from "lucide-react";
import { useId, useState } from "react";
import {
	Banner,
	type BannerProps,
	type BannerTone,
} from "../components/banner";
import { Button } from "../components/button";
import { CompactDocsPage } from "./compact-docs-page";

const tones: BannerTone[] = ["neutral", "info", "success", "warning", "error"];

type BannerStoryArgs = BannerProps & {
	showIcon: boolean;
	actionPreset: "none" | "connect" | "destructive" | "retry";
	actionDisabled: boolean;
	dismissible: boolean;
};

function BannerExample({
	showIcon,
	actionPreset,
	actionDisabled,
	dismissible,
	...args
}: BannerStoryArgs) {
	const [visible, setVisible] = useState(true);
	const [applied, setApplied] = useState(false);
	const reset = () => {
		setVisible(true);
		setApplied(false);
	};
	const destructive = actionPreset === "destructive";
	const labels = {
		none: ["", ""],
		connect: ["Connect", "Connected"],
		destructive: ["Remove credentials", "Removed"],
		retry: ["Retry", "Retried"],
	} as const;

	return (
		<div className="grid gap-3">
			{visible ? (
				<Banner
					{...args}
					icon={showIcon ? <Info aria-hidden="true" /> : undefined}
					actions={
						actionPreset === "none"
							? undefined
							: [
									{
										id: actionPreset,
										label: labels[actionPreset][applied ? 1 : 0],
										destructive,
										disabled: actionDisabled || applied,
										onClick: () => setApplied(true),
									},
									...(destructive || actionPreset === "retry"
										? [
												{
													id: "dismiss",
													label: destructive ? "Cancel" : "Dismiss for now",
													onClick: () => setVisible(false),
												},
											]
										: []),
								]
					}
					onDismiss={dismissible ? () => setVisible(false) : undefined}
				/>
			) : null}
			{!visible || applied ? (
				<Button
					className="justify-self-start"
					size="sm"
					tone="neutral"
					variant="secondary"
					onClick={reset}
				>
					{visible ? "Reset example" : "Show banner again"}
				</Button>
			) : null}
		</div>
	);
}

const meta = {
	title: "Components/Banner",
	component: Banner,
	tags: ["autodocs"],
	parameters: { docs: { page: CompactDocsPage } },
	decorators: [
		(Story) => (
			<div style={{ width: "100%", maxWidth: 900, padding: 24 }}>
				<Story />
			</div>
		),
	],
	render: (args) => <BannerExample key={args.actionPreset} {...args} />,
	args: {
		tone: "info",
		size: "md",
		title: "A new version is available",
		description: "Restart the app to finish installing the update.",
		showIcon: false,
		actionPreset: "none",
		actionDisabled: false,
		dismissible: false,
	},
	argTypes: {
		tone: { control: "select", options: tones },
		size: { control: "inline-radio", options: ["sm", "md"] },
		title: { control: "text", description: "Clear to show description only." },
		description: { control: "text" },
		showIcon: { name: "Icon", control: "boolean" },
		actionPreset: {
			name: "Actions",
			control: "select",
			options: ["none", "connect", "destructive", "retry"],
		},
		actionDisabled: {
			name: "Primary action disabled",
			control: "boolean",
			if: { arg: "actionPreset", neq: "none" },
		},
		dismissible: { control: "boolean" },
		icon: { control: false, table: { disable: true } },
		actions: { control: false, table: { disable: true } },
		onDismiss: { control: false, table: { disable: true } },
		dismissLabel: { control: "text" },
		children: { control: false },
	},
} satisfies Meta<BannerStoryArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Tones: Story = {
	parameters: { controls: { disable: true } },
	render: (args) => (
		<div className="grid gap-3">
			{tones.map((tone) => (
				<BannerExample
					{...args}
					key={tone}
					tone={tone}
					title={`${tone[0].toUpperCase()}${tone.slice(1)} notice`}
					description={undefined}
				/>
			))}
		</div>
	),
};

export const Sizes: Story = {
	parameters: { controls: { disable: true } },
	args: {
		title: "Authorization required",
		description: "Connect your account to continue.",
		showIcon: true,
		actionPreset: "connect",
	},
	render: (args) => (
		<div className="grid gap-3">
			{(["sm", "md"] as const).map((size) => (
				<div
					key={size}
					className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-3"
				>
					<span className="text-cline-ui-muted-foreground text-cline-ui-xs">
						{size}
					</span>
					<BannerExample {...args} size={size} />
				</div>
			))}
		</div>
	),
};

export const Interaction: Story = {
	args: {
		tone: "warning",
		title: "Remove saved credentials?",
		description: "You will need to sign in again to reconnect this server.",
		actionPreset: "destructive",
		dismissible: true,
	},
};

export const Responsive: Story = {
	parameters: { controls: { disable: true } },
	args: {
		title: "Connection settings could not be loaded",
		description:
			"https://example.com/organizations/averylongorganizationidentifierwithoutwordbreaks/settings",
		showIcon: true,
		actionPreset: "retry",
		dismissible: true,
	},
	render: function Responsive(args) {
		const widthId = useId();
		const [width, setWidth] = useState(260);
		return (
			<div className="grid grid-cols-1 gap-4">
				<label className="grid gap-2 text-cline-ui-xs" htmlFor={widthId}>
					Container width: {width}px (limited to available space)
					<input
						id={widthId}
						type="range"
						min={240}
						max={800}
						value={width}
						onChange={(event) => setWidth(Number(event.currentTarget.value))}
					/>
				</label>
				<div style={{ width, maxWidth: "100%" }}>
					<BannerExample {...args} />
				</div>
			</div>
		);
	},
};
