import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	type AgentChangedFileEntry,
	AgentChangedFileTree,
	AgentFilePanelHeader,
	AgentWorkspaceTree,
	type AgentWorkspaceTreeNode,
} from "../components/agent-file-tree";
import { AgentSegmentedControl } from "../components/agent-segmented-control";

const meta: Meta<typeof AgentChangedFileTree> = {
	title: "Agent/Changes rail",
	component: AgentChangedFileTree,
	tags: ["autodocs"],
};

export default meta;

type Story = StoryObj<typeof AgentChangedFileTree>;

const files: AgentChangedFileEntry[] = [
	{
		path: "webview/components/views/chat/changes-rail.tsx",
		status: "added",
		additions: 188,
		deletions: 0,
	},
	{
		path: "webview/components/agent-header.tsx",
		status: "modified",
		additions: 9,
		deletions: 3,
	},
	{
		path: "webview/app/page.tsx",
		status: "modified",
		additions: 41,
		deletions: 12,
	},
	{
		path: "sidecar/diff-view.ts",
		status: "deleted",
		additions: 0,
		deletions: 74,
	},
];

export const ChangesRail: Story = {
	render: () => {
		const [scope, setScope] = useState<"turn" | "session" | "uncommitted">(
			"session",
		);
		const [selected, setSelected] = useState<string | null>(
			files[1]?.path ?? null,
		);
		const file = files.find((entry) => entry.path === selected);
		return (
			<div className="flex h-[480px] w-[420px] flex-col overflow-hidden rounded-cline-ui-xl border border-cline-ui-border bg-cline-ui-background text-cline-ui-foreground">
				<div className="flex h-10 items-center gap-2 border-b border-cline-ui-border px-3">
					<AgentSegmentedControl
						aria-label="Scope"
						onValueChange={setScope}
						options={[
							{ value: "turn", label: "Last turn" },
							{ value: "session", label: "Session", count: files.length },
							{ value: "uncommitted", label: "Uncommitted" },
						]}
						value={scope}
					/>
				</div>
				<div className="max-h-56 overflow-auto border-b border-cline-ui-border">
					<AgentChangedFileTree
						files={files}
						onSelect={(entry) => setSelected(entry.path)}
						selectedPath={selected}
					/>
				</div>
				{file && (
					<AgentFilePanelHeader
						actions={
							<button
								className="rounded px-2 py-0.5 text-cline-ui-xs text-cline-ui-muted-foreground hover:bg-cline-ui-surface-hover"
								type="button"
							>
								Open
							</button>
						}
						additions={file.additions}
						deletions={file.deletions}
						path={file.path}
						status={file.status}
					/>
				)}
				<div className="flex-1 p-3 text-cline-ui-xs text-cline-ui-muted-foreground">
					Diff renders here (see Tool diff stories).
				</div>
			</div>
		);
	},
};

const workspace: Record<string, AgentWorkspaceTreeNode[]> = {
	"": [
		{ name: "sidecar", path: "sidecar", kind: "directory" },
		{ name: "webview", path: "webview", kind: "directory" },
		{ name: "package.json", path: "package.json", kind: "file" },
		{ name: "README.md", path: "README.md", kind: "file" },
	],
	webview: [
		{ name: "app", path: "webview/app", kind: "directory" },
		{ name: "components", path: "webview/components", kind: "directory" },
	],
	"webview/app": [
		{ name: "page.tsx", path: "webview/app/page.tsx", kind: "file" },
		{ name: "layout.tsx", path: "webview/app/layout.tsx", kind: "file" },
	],
};

export const WorkspaceBrowser: Story = {
	render: () => {
		const [expanded, setExpanded] = useState(new Set(["webview"]));
		const [selected, setSelected] = useState<string | null>(null);
		return (
			<div className="h-[320px] w-[320px] overflow-auto rounded-cline-ui-xl border border-cline-ui-border bg-cline-ui-background text-cline-ui-foreground">
				<AgentWorkspaceTree
					entries={workspace}
					expanded={expanded}
					onSelectFile={(node) => setSelected(node.path)}
					onToggleDirectory={(path) =>
						setExpanded((previous) => {
							const next = new Set(previous);
							if (next.has(path)) next.delete(path);
							else next.add(path);
							return next;
						})
					}
					selectedPath={selected}
				/>
			</div>
		);
	},
};
