import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarDays } from "lucide-react";
import { useId, useState } from "react";
import { EmptyState, type EmptyStateProps } from "../components/empty-state";
import { CompactDocsPage } from "./compact-docs-page";

type EmptyStateStoryArgs = EmptyStateProps & {
	showMedia: boolean;
	actionCount: 0 | 1 | 2;
	actionsDisabled: boolean;
	primaryActionLabel: string;
	secondaryActionLabel: string;
};

function EmptyStateExample({
	showMedia,
	actionCount,
	actionsDisabled,
	primaryActionLabel,
	secondaryActionLabel,
	...args
}: EmptyStateStoryArgs) {
	const [lastAction, setLastAction] = useState("");
	const [activations, setActivations] = useState(0);
	const activate = (label: string) => {
		setLastAction(label);
		setActivations((count) => count + 1);
	};
	return (
		<div className="grid gap-3">
			<EmptyState
				{...args}
				media={
					showMedia ? (
						<CalendarDays aria-hidden="true" size={72} strokeWidth={1} />
					) : undefined
				}
				action={
					actionCount > 0
						? {
								label: primaryActionLabel,
								disabled: actionsDisabled,
								onClick: () => activate(primaryActionLabel),
							}
						: undefined
				}
				secondaryAction={
					actionCount === 2
						? {
								label: secondaryActionLabel,
								disabled: actionsDisabled,
								onClick: () => activate(secondaryActionLabel),
							}
						: undefined
				}
			/>
			{activations > 0 ? (
				<output className="text-cline-ui-muted-foreground text-cline-ui-xs">
					{lastAction} clicked. Total actions: {activations}.
				</output>
			) : null}
		</div>
	);
}

const meta = {
	title: "Components/Empty State",
	component: EmptyState,
	tags: ["autodocs"],
	parameters: { docs: { page: CompactDocsPage } },
	decorators: [
		(Story) => (
			<div style={{ width: "100%", maxWidth: 900, padding: 24 }}>
				<Story />
			</div>
		),
	],
	render: (args) => <EmptyStateExample key={args.actionCount} {...args} />,
	args: {
		align: "left",
		size: "md",
		surface: "muted",
		headingLevel: 3,
		title: "",
		description: "No rules found.",
		showMedia: false,
		actionCount: 0,
		actionsDisabled: false,
		primaryActionLabel: "Refresh",
		secondaryActionLabel: "Browse marketplace",
	},
	argTypes: {
		align: { control: "inline-radio", options: ["left", "center"] },
		size: { control: "inline-radio", options: ["md", "lg"] },
		surface: { control: "inline-radio", options: ["muted", "transparent"] },
		showMedia: { name: "Illustration", control: "boolean" },
		title: { control: "text" },
		description: { control: "text" },
		headingLevel: { control: "select", options: [2, 3, 4, 5, 6] },
		actionCount: {
			name: "Actions",
			control: "inline-radio",
			options: [0, 1, 2],
		},
		actionsDisabled: {
			name: "Actions disabled",
			control: "boolean",
			if: { arg: "actionCount", neq: 0 },
		},
		primaryActionLabel: { control: false, table: { disable: true } },
		secondaryActionLabel: { control: false, table: { disable: true } },
		media: { control: false, table: { disable: true } },
		action: { control: false, table: { disable: true } },
		secondaryAction: { control: false, table: { disable: true } },
		children: { control: false },
	},
} satisfies Meta<EmptyStateStoryArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Illustrated: Story = {
	args: {
		align: "center",
		size: "lg",
		surface: "transparent",
		showMedia: true,
		title: "No schedules yet",
		description: "Create a schedule to run work automatically.",
		actionCount: 1,
		primaryActionLabel: "Create schedule",
	},
};

export const Actions: Story = {
	args: {
		title: "No plugins installed",
		description:
			"Refresh your installed plugins or find one in the marketplace.",
		actionCount: 2,
	},
};

export const Responsive: Story = {
	parameters: { controls: { disable: true } },
	args: {
		align: "center",
		description: "No MCP servers found.",
		actionCount: 2,
		primaryActionLabel: "Browse marketplace",
		secondaryActionLabel: "Add MCP Server",
	},
	render: function Responsive(args) {
		const widthId = useId();
		const [width, setWidth] = useState(240);
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
					<EmptyStateExample {...args} />
				</div>
			</div>
		);
	},
};
