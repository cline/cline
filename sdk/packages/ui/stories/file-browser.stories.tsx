import type { Meta, StoryObj } from "@storybook/react-vite";
import { useId, useState } from "react";
import { useArgs } from "storybook/preview-api";
import { fn } from "storybook/test";
import { Streamdown } from "streamdown";
import "../components/markdown.css";
import {
	FileBrowser,
	FileBrowserContent,
	type FileBrowserProps,
} from "../components/file-browser.js";

// Mirrors the layout of the repo's cline-sdk skill.
const files = [
	{
		path: "SKILL.md",
		content:
			"# Cline SDK Skill\n\nConsolidated skill for building AI agents with the Cline SDK.",
	},
	{
		path: "references/agent/REFERENCE.md",
		content: "# Agent\n\nThe Agent runtime and its loop.",
	},
	{
		path: "references/agent/api.md",
		content: "# Agent API\n\nConstructor options, methods, and events.",
	},
	{
		path: "references/agent/gotchas.md",
		content:
			"# Agent Gotchas\n\n## Agent Loop Never Stops\n\nIf the agent keeps iterating without completing, check its stop conditions.",
	},
	{
		path: "references/providers/REFERENCE.md",
		content: "# Providers\n\nConfiguring LLM providers and credentials.",
	},
	{
		path: "references/tools/REFERENCE.md",
		content: "# Tools\n\nDefining custom tools for an agent.",
	},
];

const openFileLocation = fn();

const Markdown = ({ children }: { children: string }) => (
	<Streamdown className="cline-markdown" mode="static">
		{children}
	</Streamdown>
);

/** Keep the selectedPath control in sync with clicks in the tree. */
function useSelect(args: FileBrowserProps) {
	const [, updateArgs] = useArgs<FileBrowserProps>();
	return (selectedPath: string) => {
		updateArgs({ selectedPath });
		args.onSelect(selectedPath);
	};
}

const meta: Meta<typeof FileBrowser> = {
	title: "Components/File Browser",
	component: FileBrowser,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"A file tree and preview pane with a shared Preview/Source segmented control. Hosts own file loading, selection, Markdown rendering, and link behavior.",
			},
		},
	},
	args: {
		"aria-label": "Skill content",
		files,
		filesLabel: "Skill files",
		selectedPath: "SKILL.md",
		onSelect: fn(),
	},
	argTypes: {
		files: {
			control: false,
			description: "Static sample files; hosts supply file data.",
		},
		children: { control: false },
		onSelect: { control: false },
		selectedPath: { control: "text" },
	},
	decorators: [
		(Story) => (
			<div style={{ padding: "1.5rem" }}>
				<Story />
			</div>
		),
	],
	render: function Browser(args) {
		const onSelect = useSelect(args);
		const file = args.files.some((file) => file.path === args.selectedPath)
			? files.find((file) => file.path === args.selectedPath)
			: undefined;
		return (
			<FileBrowser {...args} onSelect={onSelect}>
				{file ? (
					<FileBrowserContent
						key={file.path}
						path={file.path}
						content={file.content}
						onOpenFileLocation={openFileLocation}
						preview={
							file.path.endsWith(".md") ? (
								<Markdown>{file.content}</Markdown>
							) : undefined
						}
					/>
				) : null}
			</FileBrowser>
		);
	},
};
export default meta;
type Story = StoryObj<typeof FileBrowser>;

export const Default: Story = {};

export const EditableInstructions: Story = {
	render: function Instructions() {
		const labelId = useId();
		const [instructions, setInstructions] = useState(
			"## Review instructions\n\n- Summarize recent changes.\n- Call out **risks** and follow-up work.",
		);
		return (
			<FileBrowserContent
				className="overflow-hidden rounded-xl border border-border bg-card"
				sizing="content"
				minBodyHeight="12rem"
				maxBodyHeight="24rem"
				headerLabel="Instructions"
				headerLabelId={labelId}
				sourceLabel="Edit"
				defaultMode="source"
				showActions={false}
				source={
					<textarea
						aria-labelledby={labelId}
						className="block min-h-48 w-full field-sizing-content resize-none overflow-hidden bg-transparent p-5 text-sm leading-relaxed outline-offset-[-2px]"
						value={instructions}
						onChange={(event) => setInstructions(event.target.value)}
					/>
				}
				preview={
					instructions.trim() ? (
						<Markdown>{instructions}</Markdown>
					) : (
						<p className="text-muted-foreground">Nothing to preview yet.</p>
					)
				}
			/>
		);
	},
};

export const Narrow: Story = {
	decorators: [
		(Story) => (
			<div style={{ width: "100%", maxWidth: 440 }}>
				<Story />
			</div>
		),
	],
};

export const NoSelection: Story = {
	args: { selectedPath: null },
};

export const Empty: Story = {
	args: { files: [] },
};

export const Loading: Story = {
	args: { files: [], loading: true },
};

export const FileLoading: Story = {
	render: function Browser(args) {
		const path = args.selectedPath;
		return (
			<FileBrowser {...args} onSelect={useSelect(args)}>
				{path ? <FileBrowserContent key={path} path={path} loading /> : null}
			</FileBrowser>
		);
	},
};
