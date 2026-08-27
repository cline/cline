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

const sectionedModelOptions: SearchComboboxOption[] = [
	{
		badge: "NEW",
		description: "Most intelligent model for agents and coding",
		label: "Claude Opus 5",
		section: "recommended",
		value: "anthropic/claude-opus-5",
	},
	{
		badge: "NEW",
		description: "Moonshot AI's flagship MoE model for agentic coding",
		label: "Kimi K3",
		section: "recommended",
		value: "moonshotai/kimi-k3",
	},
	{
		description: "Fast and efficient with 1M context window",
		label: "DeepSeek V4 Flash",
		section: "free",
		value: "deepseek/deepseek-v4-flash",
	},
	{
		description: "Latest coding agent model from Poolside",
		label: "Laguna S 2.1",
		section: "free",
		value: "poolside/laguna-s-2.1:free",
	},
	{
		label: "Claude Sonnet 4.6",
		section: "all",
		value: "anthropic/claude-sonnet-4.6",
	},
	{ label: "GPT-5.5", section: "all", value: "openai/gpt-5.5" },
	{ label: "Gemini 3 Pro", section: "all", value: "google/gemini-3-pro" },
];

export const ModelPicker: Story = {
	args: {
		ariaLabel: "Model",
		options: sectionedModelOptions,
		panelWidth: "20rem",
		placeholder: "Select model",
		searchPlaceholder: "Search models…",
		sections: [
			{ id: "recommended", label: "Recommended" },
			{
				description: "Try with limited usage at no cost",
				id: "free",
				label: "Free",
			},
			{ id: "all", label: "All models" },
		],
		value: "anthropic/claude-opus-5",
	},
	parameters: {
		docs: {
			description: {
				story:
					"Sectioned model picker: recommended and free tiers first, the full catalog after. Searching flattens the sections into one ranked list.",
			},
		},
	},
	render: (args) => (
		<div className="flex min-h-[420px] items-start p-6">
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
