import { basename } from "node:path";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMemo } from "react";
import {
	type SearchableItem,
	SearchableList,
	useSearchableList,
} from "../searchable-list";

/** Sentinel resolved when the user picks the default Cline agent. */
export const DEFAULT_AGENT_ACTION = "__default_agent__";

export interface AgentProfileOption {
	name: string;
	description?: string;
	systemPrompt: string;
	plugins?: string[];
	tools?: string[];
	skills?: string[];
	providerId?: string;
	modelId?: string;
	source: "workspace" | "global";
}

export interface AgentProfileLoadError {
	path: string;
	message: string;
}

export function AgentSelectorContent(
	props: ChoiceContext<string> & {
		currentAgentName: string | null;
		agents: AgentProfileOption[];
		loadErrors: AgentProfileLoadError[];
	},
) {
	const { resolve, dismiss, dialogId, currentAgentName, agents, loadErrors } =
		props;

	const items: SearchableItem[] = useMemo(() => {
		const normalizedCurrent = currentAgentName?.trim().toLowerCase() ?? null;
		const toItem = (agent: AgentProfileOption): SearchableItem => ({
			key: agent.name.toLowerCase(),
			label: agent.name,
			detail: agent.description,
			section: agent.source === "workspace" ? "Workspace" : "Global",
			rightLabel:
				normalizedCurrent === agent.name.trim().toLowerCase()
					? "(current)"
					: undefined,
		});
		// The default Cline agent lives at the top of the "Global" section; it is
		// the revert-to-stock choice, not a peer profile.
		const defaultItem: SearchableItem = {
			key: DEFAULT_AGENT_ACTION,
			label: "Cline (default)",
			detail: "Standard Cline agent",
			section: "Global",
			rightLabel: normalizedCurrent === null ? "(current)" : undefined,
		};
		const globalItems = agents
			.filter((agent) => agent.source === "global")
			.map(toItem);
		const workspaceItems = agents
			.filter((agent) => agent.source === "workspace")
			.map(toItem);
		return [defaultItem, ...globalItems, ...workspaceItems];
	}, [agents, currentAgentName]);

	const list = useSearchableList(items);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return") {
			const item = list.selectedItem;
			if (item) resolve(item.key);
			return;
		}
		if (key.name === "up") {
			list.moveUp();
			return;
		}
		if (key.name === "down") {
			list.moveDown();
		}
	}, dialogId);

	return (
		<box flexDirection="column" gap={1}>
			<text>Select Agent</text>

			<SearchableList
				items={list.filtered}
				selected={list.safeSelected}
				placeholder="Search agents..."
				onSearchChange={list.setSearch}
				onItemSelect={(item) => resolve(item.key)}
				emptyText="No agents match"
				detailPosition="below"
			/>

			{loadErrors.length > 0 && (
				<box flexDirection="column">
					{loadErrors.map((error) => (
						<text key={error.path} fg="red">
							{basename(error.path)}: {error.message}
						</text>
					))}
				</box>
			)}

			<text fg="gray">
				Type to search, ↑/↓ navigate, Enter to select, Esc to go back
			</text>
		</box>
	);
}
