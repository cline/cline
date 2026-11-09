import type { Meta, StoryObj } from "@storybook/react-vite";
import { type CSSProperties, useState } from "react";
import { useArgs } from "storybook/preview-api";
import { fn } from "storybook/test";
import { Streamdown } from "streamdown";
import "../components/markdown.css";
import {
	FileBrowser,
	FileBrowserContent,
	type FileBrowserProps,
} from "../components/file-browser.js";

const files = [
	{
		path: "SKILL.md",
		content:
			"---\nname: example\n---\n# Overview\n\nInstructions for working with this skill.",
	},
	{
		path: "references/guide.md",
		content: "# Guide\n\nAdditional reference material.",
	},
	{ path: "scripts/check.ts", content: 'console.log("Ready");' },
];

const openFileLocation = fn();

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
};
export default meta;
type Story = StoryObj<typeof FileBrowser>;

export const Default: Story = {
	render: function Browser(args) {
		const [, updateArgs] = useArgs<FileBrowserProps>();
		const path = args.selectedPath;
		const file = args.files.some((candidate) => candidate.path === path)
			? files.find((candidate) => candidate.path === path)
			: undefined;
		const onSelect = (selectedPath: string) => {
			updateArgs({ selectedPath });
			args.onSelect(selectedPath);
		};
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
								<article>
									<h2>{file.path === "SKILL.md" ? "Overview" : "Guide"}</h2>
									<p>{file.content.split("\n\n").at(-1)}</p>
								</article>
							) : undefined
						}
					/>
				) : null}
			</FileBrowser>
		);
	},
};

export const EditableInstructions: Story = {
	render: function Instructions() {
		const [instructions, setInstructions] = useState(
			"## Review instructions\n\n- Summarize recent changes.\n- Call out **risks** and follow-up work.",
		);
		return (
			<FileBrowserContent
				className="overflow-hidden rounded-xl border border-border bg-card"
				style={
					{ "--cline-ui-file-browser-body-height": "20rem" } as CSSProperties
				}
				headerLabel="Instructions"
				sourceLabel="Edit"
				defaultMode="source"
				showActions={false}
				source={
					<textarea
						aria-label="Instructions"
						className="block h-full w-full resize-none bg-transparent p-5 text-sm leading-relaxed outline-offset-[-2px]"
						value={instructions}
						onChange={(event) => setInstructions(event.target.value)}
					/>
				}
				preview={
					instructions.trim() ? (
						<Streamdown className="cline-markdown" mode="static">
							{instructions}
						</Streamdown>
					) : (
						<p className="text-muted-foreground">Nothing to preview yet.</p>
					)
				}
			/>
		);
	},
};

export const Narrow: Story = {
	...Default,
	decorators: [
		(Story) => (
			<div style={{ width: "100%", maxWidth: 440 }}>
				<Story />
			</div>
		),
	],
};

export const Loading: Story = {
	args: {
		files: [],
		loading: true,
	},
};

export const FileLoading: Story = {
	render: function Browser(args) {
		const [, updateArgs] = useArgs<FileBrowserProps>();
		const path = args.selectedPath;
		const onSelect = (selectedPath: string) => {
			updateArgs({ selectedPath });
			args.onSelect(selectedPath);
		};
		return (
			<FileBrowser {...args} onSelect={onSelect}>
				{path ? <FileBrowserContent key={path} path={path} loading /> : null}
			</FileBrowser>
		);
	},
};

export const NarrowLoading: Story = {
	...Loading,
	decorators: Narrow.decorators,
};

export const Empty: Story = {
	args: { files: [] },
};

export const WithoutActions: Story = {
	render: (args) => (
		<FileBrowser {...args} selectedPath="SKILL.md">
			<FileBrowserContent
				path="SKILL.md"
				content={files[0].content}
				showActions={false}
			/>
		</FileBrowser>
	),
};

export const NoSelection: Story = {
	...Default,
	args: { selectedPath: null },
};

export const NestedFolders: Story = {
	args: {
		files: [{ path: "references/examples/nested.md" }, { path: "SKILL.md" }],
		selectedPath: null,
	},
	render: function Browser(args) {
		const [, updateArgs] = useArgs<FileBrowserProps>();
		return (
			<FileBrowser
				{...args}
				onSelect={(selectedPath) => {
					updateArgs({ selectedPath });
					args.onSelect(selectedPath);
				}}
			>
				{args.selectedPath ? (
					<FileBrowserContent
						key={args.selectedPath}
						path={args.selectedPath}
						content="# Nested reference"
					/>
				) : null}
			</FileBrowser>
		);
	},
};
