import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	SearchCombobox,
	type SearchComboboxOption,
	type SearchComboboxProps,
} from "../components/search-combobox";

const repositoryOptions: SearchComboboxOption[] = [
	{ label: "cline/cline", value: "cline" },
	{
		description: "Cloud dashboard",
		label: "cline/core-platform",
		value: "core-platform",
	},
	{
		description: "Shared agent UI",
		label: "cline/ui",
		value: "ui",
	},
];

const modelOptions: SearchComboboxOption[] = [
	{
		description: "Anthropic",
		label: "Claude Sonnet 4",
		value: "claude-sonnet-4",
	},
	{
		description: "Anthropic",
		label: "Claude Opus 4",
		value: "claude-opus-4",
	},
	{
		description: "OpenAI",
		label: "GPT-5",
		value: "gpt-5",
	},
];

const meta: Meta<typeof SearchCombobox> = {
	title: "Components/Search combobox",
	component: SearchCombobox,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Searchable single-select trigger with a filterable option panel. Hosts own the selected value.",
			},
		},
	},
	args: {
		ariaLabel: "Repository",
		onValueChange: () => {},
		options: repositoryOptions,
		placeholder: "Select repository",
		searchPlaceholder: "Search repositories…",
		value: "cline",
	},
};

export default meta;

type Story = StoryObj<typeof SearchCombobox>;

function InteractiveCombobox({
	initialValue,
	...props
}: Omit<SearchComboboxProps, "onValueChange" | "value"> & {
	initialValue?: string;
}) {
	const [value, setValue] = useState(initialValue);

	return <SearchCombobox {...props} onValueChange={setValue} value={value} />;
}

export const Default: Story = {
	render: (args) => (
		<div className="flex min-h-[280px] items-start p-6">
			<InteractiveCombobox {...args} initialValue={args.value} />
		</div>
	),
};

export const PlacementTop: Story = {
	args: {
		ariaLabel: "Model",
		options: modelOptions,
		placeholder: "Select model",
		placement: "top",
		searchPlaceholder: "Search models…",
		value: "claude-sonnet-4",
	},
	render: (args) => (
		<div className="flex min-h-[280px] items-end p-6">
			<InteractiveCombobox {...args} initialValue={args.value} />
		</div>
	),
};

export const Loading: Story = {
	args: {
		ariaLabel: "Model",
		loading: true,
		loadingText: "Loading models…",
		options: modelOptions,
		placeholder: "Select model",
	},
	render: (args) => (
		<div className="p-6">
			<SearchCombobox {...args} />
		</div>
	),
};

export const Disabled: Story = {
	args: {
		disabled: true,
	},
	render: (args) => (
		<div className="p-6">
			<SearchCombobox {...args} />
		</div>
	),
};

export const EmptyResults: Story = {
	args: {
		emptyText: "No repositories match",
		options: [],
		placeholder: "Select repository",
		value: undefined,
	},
	render: (args) => (
		<div className="flex min-h-[280px] items-start p-6">
			<SearchCombobox {...args} />
		</div>
	),
};
