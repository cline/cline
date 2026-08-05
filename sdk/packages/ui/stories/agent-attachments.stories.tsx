import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentAttachments } from "../components/index.js";

const attachments = [
	{
		id: "screenshot",
		label: "dashboard.png",
		mediaType: "image/png",
		src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	},
	{ id: "notes", label: "notes.txt", mediaType: "text/plain" },
];

const meta = {
	title: "Agent/Attachments",
	component: AgentAttachments,
	tags: ["autodocs"],
	args: {
		attachments,
		onRemove: () => undefined,
	},
} satisfies Meta<typeof AgentAttachments>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Grid: Story = {};

export const Inline: Story = {
	args: { variant: "inline" },
};

export const Disabled: Story = {
	args: { disabled: true },
};
