import type { Meta, StoryObj } from "@storybook/react-vite";
import { useId, useState } from "react";
import { useArgs } from "storybook/preview-api";
import { fn } from "storybook/test";
import { Streamdown } from "streamdown";
import "../components/markdown.css";
import { Button } from "../components/button.js";
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

const largeFiles = Array.from({ length: 10_000 }, (_, index) => ({
	path: `packages/package-${String(Math.floor(index / 100)).padStart(3, "0")}/file-${String(index % 100).padStart(3, "0")}.ts`,
}));

export const LargeTree: Story = {
	parameters: {
		docs: {
			description: {
				story:
					"10,000 files with automatic windowing. Tab and Shift+Tab traverse every expanded row. This example host removes the selected file on Delete to demonstrate focus recovery.",
			},
		},
	},
	render: function LargeBrowser(args) {
		const [items, setItems] = useState(largeFiles);
		const [selectedPath, setSelectedPath] = useState<string | null>(null);
		return (
			<>
				<p className="mb-3 text-sm text-muted-foreground">
					{items.length.toLocaleString()} files. Tab through the tree; press
					Delete to remove the selected file.
				</p>
				<FileBrowser
					{...args}
					files={items}
					selectedPath={selectedPath}
					onSelect={setSelectedPath}
					onKeyDown={(event) => {
						if (event.key === "Delete" && selectedPath) {
							event.preventDefault();
							setItems((current) =>
								current.filter((file) => file.path !== selectedPath),
							);
							setSelectedPath(null);
						}
					}}
				>
					{selectedPath ? (
						<FileBrowserContent
							path={selectedPath}
							content={`// ${selectedPath}\nexport const ready = true;`}
							showActions={false}
						/>
					) : null}
				</FileBrowser>
				<Button
					className="mt-3"
					onClick={() => {
						setItems(largeFiles);
						setSelectedPath(null);
					}}
				>
					Reset files
				</Button>
			</>
		);
	},
};
