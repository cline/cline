import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import {
	AgentChangedFile,
	AgentChangesPanel,
} from "../components/agent-changes";

const meta: Meta<typeof AgentChangesPanel> = {
	title: "Agent/Changes panel",
	component: AgentChangesPanel,
	tags: ["autodocs"],
	args: {
		fileCount: 2,
		onClose: () => {},
		title: "Changes",
	},
};

export default meta;

type Story = StoryObj<typeof AgentChangesPanel>;

function MockDiff({ label }: { label: string }) {
	return (
		<pre className="overflow-x-auto rounded bg-cline-ui-muted p-3 text-cline-ui-xs">
			{`- previous ${label}\n+ updated ${label}`}
		</pre>
	);
}

const files = [
	"sdk/packages/ui/components/agent-changes.tsx",
	"apps/examples/desktop-app/webview/components/views/chat/diff-view.tsx",
];

function PanelFrame({
	children,
	narrow = false,
}: {
	children: ReactNode;
	narrow?: boolean;
}) {
	return (
		<div
			className={`h-[480px] max-w-full border border-cline-ui-border ${narrow ? "w-[390px]" : ""}`}
		>
			{children}
		</div>
	);
}

function ChangedFile({
	initialExpanded,
	path,
	index,
}: {
	initialExpanded: boolean;
	path: string;
	index: number;
}) {
	const [expanded, setExpanded] = useState(initialExpanded);
	return (
		<AgentChangedFile
			additions={index + 3}
			deletions={index + 1}
			expanded={expanded}
			onCopyPath={() => {}}
			onExpandedChange={setExpanded}
			path={path}
		>
			<MockDiff label={path} />
		</AgentChangedFile>
	);
}

function Changes({ collapsed = false, long = false, narrow = false }) {
	const paths = long
		? Array.from({ length: 12 }, (_, index) =>
				index === 0
					? "apps/examples/desktop-app/webview/components/views/chat/a-very-long-file-name-for-responsive-layout.tsx"
					: `sdk/packages/ui/components/example-${index}.tsx`,
			)
		: files;
	return (
		<PanelFrame narrow={narrow}>
			<AgentChangesPanel
				fileCount={paths.length}
				onClose={() => {}}
				title="Changes"
			>
				{paths.map((path, index) => (
					<ChangedFile
						initialExpanded={collapsed ? false : index === 0}
						index={index}
						key={path}
						path={path}
					/>
				))}
			</AgentChangesPanel>
		</PanelFrame>
	);
}

export const Default: Story = {
	render: () => <Changes />,
};

export const Empty: Story = {
	args: {
		emptyMessage: "No changes in this session.",
		fileCount: 0,
	},
	render: (args) => (
		<PanelFrame>
			<AgentChangesPanel {...args} />
		</PanelFrame>
	),
};

export const CollapsedFiles: Story = {
	render: () => <Changes collapsed />,
};

export const LongListOnNarrowViewport: Story = {
	render: () => <Changes long narrow />,
};
