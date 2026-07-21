import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { AgentApprovalCard, AgentComposer, AgentSurface } from "../src";

const meta: Meta<typeof AgentComposer> = {
	title: "Agent controls/Interactions",
	component: AgentComposer,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Transport-neutral prompt and approval controls. Consumers retain runtime state, submission, and approval orchestration.",
			},
		},
	},
};

export default meta;

export const WelcomeComposer = () => {
	const [prompt, setPrompt] = useState("");

	return (
		<div className="mx-auto max-w-3xl p-8">
			<AgentSurface>
				<AgentComposer
					onSubmit={() => undefined}
					onValueChange={setPrompt}
					variant="welcome"
					value={prompt}
				/>
			</AgentSurface>
		</div>
	);
};

export const RunningComposer = () => (
	<div className="mx-auto max-w-3xl p-8">
		<AgentSurface>
			<AgentComposer
				onStop={() => undefined}
				onSubmit={() => undefined}
				onValueChange={() => undefined}
				running
				value=""
			/>
		</AgentSurface>
	</div>
);

export const Approval = () => (
	<div className="mx-auto max-w-3xl p-8">
		<AgentSurface>
			<AgentApprovalCard
				description="The agent needs permission before it continues."
				detail="bun -F @cline/ui test"
				onApprove={() => undefined}
				onReject={() => undefined}
				title="Run a command?"
			/>
		</AgentSurface>
	</div>
);
