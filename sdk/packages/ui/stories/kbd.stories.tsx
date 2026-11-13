import type { Meta, StoryObj } from "@storybook/react-vite";
import { Kbd, KbdGroup } from "../components/kbd";

const meta: Meta<typeof Kbd> = {
	title: "Components/Kbd",
	component: Kbd,
	tags: ["autodocs"],
	args: { children: "⌘" },
};

export default meta;

type Story = StoryObj<typeof Kbd>;

export const Default: Story = {};

export const Shortcut: Story = {
	render: () => (
		<KbdGroup>
			<Kbd>⌘</Kbd>
			<Kbd>⇧</Kbd>
			<Kbd>K</Kbd>
		</KbdGroup>
	),
};
