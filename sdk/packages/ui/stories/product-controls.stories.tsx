import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import {
	AgentActivity,
	AgentComposer,
	AgentQuickActions,
	AgentSurface,
	SearchCombobox,
	SessionStatus,
} from "../src";

const meta: Meta<typeof AgentSurface> = {
	title: "Agent controls/Workflow",
	component: AgentSurface,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Product-neutral controls for agent setup and interaction. Consumers retain repository data, routing, sessions, and transport.",
			},
		},
	},
};

export default meta;

const repositories = [
	{ label: "cline/cline", value: "https://github.com/cline/cline" },
	{
		label: "cline/core-platform",
		value: "https://github.com/cline/core-platform",
	},
];

export const StartingWorkflow = () => {
	const [prompt, setPrompt] = useState("");
	const [repository, setRepository] = useState(repositories[0].value);

	return (
		<div className="mx-auto max-w-3xl p-8">
			<AgentSurface>
				<div className="mb-6 flex items-center justify-between">
					<div>
						<h1 className="text-xl font-semibold">Start an agent</h1>
						<p className="text-sm text-muted-foreground">
							Choose a repository and describe the work.
						</p>
					</div>
					<SessionStatus label="Ready" tone="success" />
				</div>
				<SearchCombobox
					ariaLabel="Repository"
					onValueChange={setRepository}
					options={repositories}
					value={repository}
				/>
				<div className="mt-4">
					<AgentComposer
						onSubmit={() => undefined}
						onValueChange={setPrompt}
						value={prompt}
					/>
				</div>
				<div className="mt-4">
					<AgentQuickActions
						actions={[
							{
								description: "Find correctness and maintainability issues",
								id: "review",
								label: "Review this repository",
								value: "Review this repository",
							},
						]}
						onSelect={(action) => setPrompt(action.value)}
					/>
				</div>
			</AgentSurface>
		</div>
	);
};

export const Running = () => (
	<div className="mx-auto max-w-3xl p-8">
		<AgentSurface>
			<SessionStatus label="Running" tone="running" />
			<div className="mt-4">
				<AgentActivity
					detail="bun -F @cline/ui test"
					label="Running component tests"
					status="running"
				/>
			</div>
			<div className="mt-4">
				<AgentComposer
					onStop={() => undefined}
					onSubmit={() => undefined}
					onValueChange={() => undefined}
					running
					value=""
				/>
			</div>
		</AgentSurface>
	</div>
);
