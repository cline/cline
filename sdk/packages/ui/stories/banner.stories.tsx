import type { Meta, StoryObj } from "@storybook/react-vite";
import { CheckCircle2, Info } from "lucide-react";
import { useState } from "react";
import { Banner, type BannerTone } from "../components/banner";
import { Button } from "../components/button";

const tones: BannerTone[] = ["neutral", "info", "success", "warning", "error"];
const meta = {
	title: "Components/Banner",
	component: Banner,
	tags: ["autodocs"],
	decorators: [
		(Story) => (
			<div style={{ width: "100%", maxWidth: 1000, padding: 24 }}>
				<Story />
			</div>
		),
	],
	args: {
		tone: "info",
		size: "md",
		title: "A new version is available",
		description: "Restart the app to finish installing the update.",
	},
	argTypes: {
		tone: { control: "select", options: tones },
		size: { control: "inline-radio", options: ["sm", "md"] },
		title: { control: "text" },
		description: { control: "text" },
		icon: { control: false },
		actions: { control: false },
		onDismiss: { control: false },
		dismissLabel: { control: "text" },
		children: { control: false },
	},
} satisfies Meta<typeof Banner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Dismissible: Story = {
	render: function Dismissible(args) {
		const [visible, setVisible] = useState(true);
		return visible ? (
			<Banner {...args} onDismiss={() => setVisible(false)} />
		) : (
			<Button
				tone="neutral"
				variant="secondary"
				onClick={() => setVisible(true)}
			>
				Show banner again
			</Button>
		);
	},
};

export const Sizes: Story = {
	argTypes: { size: { control: false } },
	args: {
		icon: <Info aria-hidden="true" />,
		actions: [{ id: "restart", label: "Restart" }],
	},
	render: (args) => (
		<div style={{ display: "grid", gap: 24 }}>
			{(["sm", "md"] as const).map((size) => (
				<div key={size} style={{ display: "grid", gap: 8 }}>
					<span className="text-cline-ui-muted-foreground text-cline-ui-xs">
						{size}
					</span>
					<Banner {...args} size={size} />
				</div>
			))}
		</div>
	),
};

export const AllTones: Story = {
	argTypes: { tone: { control: false }, title: { control: false } },
	args: {
		actions: [
			{ id: "restart", label: "Restart" },
			{ id: "later", label: "Later" },
		],
		onDismiss: () => {},
	},
	render: (args) => (
		<div style={{ display: "grid", gap: 12 }}>
			{tones.map((tone) => (
				<Banner {...args} key={tone} tone={tone} title={`${tone} notice`} />
			))}
		</div>
	),
};

export const DestructiveAction: Story = {
	args: {
		tone: "warning",
		title: "Remove saved credentials?",
		description: "You will need to sign in again to reconnect this server.",
		actions: [
			{ id: "remove", label: "Remove credentials", destructive: true },
			{ id: "cancel", label: "Cancel" },
		],
	},
};

export const DescriptionOnly: Story = {
	args: {
		tone: "error",
		title: undefined,
		description: "Unable to save your changes. Try again.",
	},
};

export const WithIcon: Story = {
	args: {
		tone: "success",
		title: "Connected",
		description: "Your account is ready to use.",
		icon: <CheckCircle2 aria-hidden="true" />,
	},
};

export const WithActions: Story = {
	argTypes: {
		tone: { control: false },
		title: { control: false },
		description: { control: false },
	},
	render: function WithActions(args) {
		const [connected, setConnected] = useState(false);
		return (
			<Banner
				{...args}
				tone={connected ? "success" : "warning"}
				title={connected ? "Connected" : "Authorization required"}
				description={
					connected
						? "Your account is ready to use."
						: "Connect your account to continue."
				}
				actions={[
					{
						id: "connect",
						label: connected ? "Connected" : "Connect",
						disabled: connected,
						onClick: () => setConnected(true),
					},
				]}
			/>
		);
	},
};

export const NarrowWithLongContent: Story = {
	args: {
		title: "Connection settings could not be loaded",
		description:
			"https://example.com/organizations/averylongorganizationidentifierwithoutwordbreaks/settings",
		icon: <Info aria-hidden="true" />,
		actions: [
			{ id: "retry", label: "Retry" },
			{ id: "settings", label: "View settings" },
		],
	},
	decorators: [
		(Story) => (
			<div style={{ width: 260, maxWidth: "100%" }}>
				<Story />
			</div>
		),
	],
};
