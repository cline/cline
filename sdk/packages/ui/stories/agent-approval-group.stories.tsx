import type { Meta } from "@storybook/react-vite";
import { AgentApprovalCard } from "../components/agent-approval-card";
import { AgentApprovalGroup } from "../components/agent-approval-group";

const meta: Meta<typeof AgentApprovalGroup> = {
	title: "Components/Agent approval group",
	component: AgentApprovalGroup,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Warning-toned section chrome that stacks approval cards under a shared icon, title, and description. Decision orchestration stays in the consumer; the accent defaults to the shared warning role and can be overridden per host.",
			},
		},
	},
};

export default meta;

function ClockIcon() {
	return <span aria-hidden="true">◷</span>;
}

const noop = () => {};

export const SingleRequest = () => (
	<div className="max-w-2xl p-6">
		<AgentApprovalGroup
			description="Review each tool call and approve or reject it before execution."
			title="Tool approval required"
		>
			<AgentApprovalCard
				description="Request req_301 · Iteration 2"
				detail={'{\n  "commands": ["bun run build"]\n}'}
				meta={
					<>
						<ClockIcon /> Just now
					</>
				}
				onApprove={noop}
				onReject={noop}
				title="run_commands"
			/>
		</AgentApprovalGroup>
	</div>
);

export const StackedRequests = () => (
	<div className="max-w-2xl p-6">
		<AgentApprovalGroup
			description="Review each tool call and approve or reject it before execution."
			title="Tool approval required"
		>
			<AgentApprovalCard
				description="Request req_301"
				detail={'{\n  "path": "src/index.ts"\n}'}
				onApprove={noop}
				onReject={noop}
				title="editor"
			/>
			<AgentApprovalCard
				description="Request req_302"
				detail={'{\n  "commands": ["rm -rf dist"]\n}'}
				error="Could not submit decision."
				onApprove={noop}
				onReject={noop}
				title="run_commands"
			/>
			<AgentApprovalCard
				description="Request req_303"
				detail={'{\n  "requests": [{ "url": "https://cline.bot" }]\n}'}
				onApprove={noop}
				onReject={noop}
				responding="approve"
				title="fetch_web_content"
			/>
		</AgentApprovalGroup>
	</div>
);

export const CustomIconAndAccent = () => (
	<div className="approval-group-accent-demo max-w-2xl p-6">
		<style>{`
			.approval-group-accent-demo .cline-ui-agent-approval-group {
				--cline-ui-agent-approval-group-accent: var(--info-solid);
				--cline-ui-agent-approval-group-accent-border: var(--info-border);
			}
		`}</style>
		<AgentApprovalGroup
			description="This host overrides the accent variables and icon slot."
			icon={<span aria-hidden="true">⚑</span>}
			title="Pending decisions"
		>
			<AgentApprovalCard
				description="Request req_401"
				onApprove={noop}
				onReject={noop}
				title="spawn_agent"
			/>
		</AgentApprovalGroup>
	</div>
);
