import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRight } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "../components/button";
import {
	SectionHeading,
	type SectionHeadingProps,
} from "../components/section-heading";
import { CompactDocsPage } from "./compact-docs-page";

const SIZES = ["sm", "md", "base", "lg", "xl", "2xl"] as const;

type SectionHeadingStoryArgs = SectionHeadingProps & {
	showCount: boolean;
	showDescription: boolean;
	showActions: boolean;
};

function SectionHeadingExample({
	showCount,
	showDescription,
	showActions,
	...props
}: SectionHeadingStoryArgs) {
	const [viewingAll, setViewingAll] = useState(false);
	return (
		<SectionHeading
			{...props}
			count={showCount ? props.count : undefined}
			description={showDescription ? props.description : undefined}
			actions={
				showActions ? (
					<Button
						variant="ghost"
						tone="neutral"
						size="sm"
						trailingIcon={viewingAll ? undefined : ArrowRight}
						onClick={() => setViewingAll((value) => !value)}
					>
						{viewingAll ? "Show less" : "View all"}
					</Button>
				) : undefined
			}
		/>
	);
}

const meta = {
	title: "Components/Section Heading",
	component: SectionHeading,
	tags: ["autodocs"],
	parameters: {
		docs: {
			page: CompactDocsPage,
			description: {
				component:
					"A section heading with optional count, description, and actions. Visual size is independent of heading level. In narrow containers, actions move below the description.",
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
	args: {
		title: "Skills",
		count: 16,
		description: "Manage the skills available to your workspace.",
		showCount: true,
		showDescription: false,
		showActions: false,
	},
	argTypes: {
		title: { control: "text" },
		showCount: { name: "Show count", control: "boolean" },
		count: { control: "number", if: { arg: "showCount" } },
		showDescription: { name: "Show description", control: "boolean" },
		description: { control: "text", if: { arg: "showDescription" } },
		showActions: { name: "Show action", control: "boolean" },
		actions: { control: false, table: { disable: true } },
		size: { control: "select", options: SIZES },
		headingLevel: { control: "select", options: [2, 3, 4, 5, 6] },
	},
	render: (args) => <SectionHeadingExample {...args} />,
} satisfies Meta<SectionHeadingStoryArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Sizes: Story = {
	argTypes: { size: { control: false } },
	render: (args) => (
		<div className="overflow-x-auto">
			<table
				aria-label="Section heading sizes"
				className="w-full border-separate border-spacing-x-6 border-spacing-y-6 text-start"
			>
				<thead className="text-cline-ui-muted-foreground text-cline-ui-xs">
					<tr>
						<th className="text-start font-medium" scope="col">
							Size
						</th>
						<th className="text-start font-medium" scope="col">
							Section heading
						</th>
					</tr>
				</thead>
				<tbody>
					{SIZES.map((size) => (
						<tr data-size-row={size} key={size}>
							<th
								className="w-12 text-start font-medium text-cline-ui-sm"
								scope="row"
							>
								{size}
							</th>
							<td>
								<SectionHeadingExample {...args} size={size} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	),
};

export const Playground: Story = {
	args: { showDescription: true, showActions: true },
	parameters: {
		docs: {
			description: {
				story:
					"Toggle the optional content, set count to zero, and try the action.",
			},
		},
	},
};

export const Responsive: Story = {
	args: {
		title: "Skills and workflows for your workspace",
		count: 12850,
		description:
			"Install and configure reusable skills, then choose which ones are available in this workspace.",
		showDescription: true,
		showActions: true,
	},
	parameters: {
		controls: { disable: true },
		docs: {
			description: {
				story:
					"Adjust the width to compare title wrapping, the inline count, and action placement.",
			},
		},
	},
	render: function Responsive(args) {
		const sliderId = useId();
		const [width, setWidth] = useState(640);
		return (
			<div className="grid grid-cols-1 gap-4" style={{ maxWidth: 720 }}>
				<div className="grid gap-2">
					<label
						className="text-cline-ui-muted-foreground text-cline-ui-xs"
						htmlFor={sliderId}
					>
						Heading width: {width}px (limited to available space)
					</label>
					<input
						id={sliderId}
						type="range"
						min={240}
						max={720}
						value={width}
						onChange={(event) => setWidth(event.currentTarget.valueAsNumber)}
						className="w-full"
					/>
				</div>
				<div style={{ width, maxWidth: "100%" }}>
					<SectionHeadingExample {...args} />
				</div>
			</div>
		);
	},
};
