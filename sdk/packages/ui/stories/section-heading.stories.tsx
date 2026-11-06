import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/button";
import { SectionHeading } from "../components/section-heading";

function ViewAll({ onClick }: { onClick?: () => void }) {
	return (
		<Button
			variant="ghost"
			tone="neutral"
			size="sm"
			trailingIcon={ArrowRight}
			onClick={onClick}
		>
			View all
		</Button>
	);
}

const meta = {
	title: "Components/Section Heading",
	component: SectionHeading,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"A plain section heading with an optional description, count, and trailing actions. Visual size is independent of heading level. The count follows the last line of the title. In narrow containers, actions appear below the description and align to the start. Consumers own action behavior and surrounding spacing.",
			},
		},
	},
	decorators: [
		(Story) => (
			<div className="w-full max-w-275 p-6">
				<Story />
			</div>
		),
	],
	args: { title: "Skills", count: 16 },
	argTypes: {
		title: { control: "text" },
		description: { control: "text" },
		count: { control: "number" },
		actions: { control: false },
		size: {
			control: "select",
			options: ["sm", "md", "base", "lg", "xl", "2xl"],
		},
		headingLevel: { control: "select", options: [2, 3, 4, 5, 6] },
	},
} satisfies Meta<typeof SectionHeading>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Small: Story = { args: { size: "sm" } };
export const Medium: Story = { args: { size: "md" } };
export const Base: Story = { args: { size: "base" } };
export const Large: Story = {};
export const ExtraLarge: Story = { args: { size: "xl" } };
export const TwoExtraLarge: Story = { args: { size: "2xl" } };
export const WithoutCount: Story = {
	args: { title: "Installed", count: undefined },
};
export const ZeroCount: Story = { args: { title: "Rules", count: 0 } };
export const WithDescription: Story = {
	args: {
		title: "Suggested",
		count: undefined,
		description:
			"Connector combinations that work well together. Install the ones you are missing to unlock the workflow.",
		actions: <ViewAll />,
	},
};
export const Sizes: Story = {
	render: (args) => (
		<div className="grid gap-8">
			{(["sm", "md", "base", "lg", "xl", "2xl"] as const).map((size) => (
				<SectionHeading
					{...args}
					key={size}
					size={size}
					actions={<ViewAll />}
				/>
			))}
		</div>
	),
};
export const WithActions: Story = {
	args: { title: "Skills", count: 12 },
	render: function WithActions(args) {
		const [viewingAll, setViewingAll] = useState(false);
		return (
			<div className="grid gap-4">
				<SectionHeading
					{...args}
					actions={
						viewingAll ? (
							<Button
								variant="ghost"
								tone="neutral"
								size="sm"
								onClick={() => setViewingAll(false)}
							>
								Show less
							</Button>
						) : (
							<ViewAll onClick={() => setViewingAll(true)} />
						)
					}
				/>
			</div>
		);
	},
};
export const Narrow: Story = {
	args: {
		title: "Skills and workflows for your workspace",
		count: 12850,
		description:
			"Here's an example of what can be a long description and what it would look like in this component.",
		actions: <ViewAll />,
	},
	decorators: [
		(Story) => (
			<div style={{ width: 260, maxWidth: "100%" }}>
				<Story />
			</div>
		),
	],
};
