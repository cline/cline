import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import {
	AgentPullRequestBar,
	type AgentPullRequestData,
} from "../components/agent-pull-request-bar";

const readyPullRequest: AgentPullRequestData = {
	repository: "cline/cline",
	branch: "refactor/shared-agent-review-ui",
	branchUrl:
		"https://github.com/cline/cline/tree/refactor/shared-agent-review-ui",
	published: true,
	pullRequest: {
		number: 14408,
		title: "Share desktop Changes and PR presentation",
		url: "https://github.com/cline/cline/pull/14408",
		state: "OPEN",
		isDraft: false,
		mergeable: "MERGEABLE",
		mergeStateStatus: "CLEAN",
		additions: 612,
		deletions: 421,
		checks: [
			{ name: "SDK tests", state: "success" },
			{ name: "Typecheck", state: "success" },
		],
	},
};

const meta: Meta<typeof AgentPullRequestBar> = {
	title: "Agent/Pull request bar",
	component: AgentPullRequestBar,
	tags: ["autodocs"],
	args: {
		data: readyPullRequest,
		onRefresh: () => {},
		renderChecks: (trigger) => trigger,
	},
};

export default meta;

type Story = StoryObj<typeof AgentPullRequestBar>;

function frame(story: ReactElement, narrow = false) {
	return (
		<div
			className={`max-w-full border border-cline-ui-border ${narrow ? "w-[390px]" : ""}`}
		>
			{story}
		</div>
	);
}

export const ReadyToMerge: Story = {
	render: (args) => frame(<AgentPullRequestBar {...args} />),
};

export const Loading: Story = {
	args: { loading: true },
	render: ReadyToMerge.render,
};

export const ErrorState: Story = {
	args: {
		error: "Pull request status could not be loaded.",
		onDismissError: () => {},
	},
	render: ReadyToMerge.render,
};

export const FailedChecksOpen: Story = {
	args: {
		data: {
			...readyPullRequest,
			pullRequest: {
				...readyPullRequest.pullRequest!,
				mergeStateStatus: "UNSTABLE",
				checks: [
					{ name: "SDK tests", state: "failure" },
					{ name: "Typecheck", state: "success" },
					{ name: "Visual regression", state: "pending" },
				],
			},
		},
		renderChecks: (trigger, content) => (
			<div className="relative">
				{trigger}
				<div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-md border border-cline-ui-border bg-cline-ui-card shadow-lg">
					{content}
				</div>
			</div>
		),
	},
	render: (args) => (
		<div className="min-h-56 border border-cline-ui-border">
			<AgentPullRequestBar {...args} />
		</div>
	),
};

export const LongBranchOnNarrowViewport: Story = {
	args: {
		data: {
			...readyPullRequest,
			branch:
				"refactor/share-agent-review-presentation-across-desktop-and-web-hosts",
		},
	},
	render: (args) => frame(<AgentPullRequestBar {...args} />, true),
};
