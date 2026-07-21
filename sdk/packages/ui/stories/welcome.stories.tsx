import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import {
	AgentHeroHeading,
	AgentQuickActions,
	AgentSurface,
	SearchCombobox,
	SessionStatus,
} from "../src";

const meta: Meta<typeof AgentSurface> = {
	title: "Agent controls/Welcome",
	component: AgentSurface,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Product-neutral setup controls. Hosts retain repository data, routing, session creation, and transport.",
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
	const [repository, setRepository] = useState(repositories[0].value);

	return (
		<div className="mx-auto max-w-3xl p-8">
			<AgentSurface>
				<div className="mb-6 flex items-center justify-between">
					<AgentHeroHeading />
					<SessionStatus label="Ready" tone="success" />
				</div>
				<SearchCombobox
					ariaLabel="Repository"
					onValueChange={setRepository}
					options={repositories}
					value={repository}
				/>
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
						onSelect={() => undefined}
					/>
				</div>
			</AgentSurface>
		</div>
	);
};
