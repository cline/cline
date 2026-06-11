import { sep } from "node:path";
import { loadConfiguredAgentConfigs } from "@cline/core";
import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import { useCallback } from "react";
import type { Config } from "../../utils/types";
import {
	type AgentProfileLoadError,
	type AgentProfileOption,
	AgentSelectorContent,
	DEFAULT_AGENT_ACTION,
} from "../components/dialogs/agent-selector";
import { withLoadingDialog } from "../components/dialogs/loading-dialog";
import { useSession } from "../contexts/session-context";
import type { TuiProps } from "../types";

function loadAgentProfileEntries(config: Config): {
	agents: AgentProfileOption[];
	loadErrors: AgentProfileLoadError[];
} {
	const workspaceRoot = config.workspaceRoot?.trim() || config.cwd;
	const { configs, errors } = loadConfiguredAgentConfigs({ workspaceRoot });
	return {
		agents: configs.map((profile) => ({
			name: profile.name,
			description: profile.description,
			systemPrompt: profile.systemPrompt,
			plugins: profile.plugins?.map((plugin) => plugin.name),
			source:
				workspaceRoot && profile.path?.startsWith(`${workspaceRoot}${sep}`)
					? ("workspace" as const)
					: ("global" as const),
		})),
		loadErrors: errors.map((error) => ({
			path: error.path,
			message: error.error.message,
		})),
	};
}

export function useAgentSelector(opts: {
	dialog: DialogActions;
	config: Config;
	termHeight: number;
	onAgentProfileChange: TuiProps["onAgentProfileChange"];
	refocusTextarea: () => void;
}): () => Promise<void> {
	const { dialog, config, termHeight, onAgentProfileChange, refocusTextarea } =
		opts;
	const session = useSession();

	const openAgentSelector = useCallback(async () => {
		// Applying a profile restarts the session in place, so refuse while a
		// turn is running instead of yanking the live stream out from under it.
		if (session.isRunning) {
			session.appendEntry({
				kind: "status",
				text: "Finish or abort the current task before switching agents.",
			});
			refocusTextarea();
			return;
		}
		const { agents, loadErrors } = loadAgentProfileEntries(config);
		const currentAgentName = config.agentProfile?.name ?? null;

		const selectedKey = await dialog.choice<string>({
			style: { maxHeight: termHeight - 2 },
			content: (ctx: ChoiceContext<string>) => (
				<AgentSelectorContent
					{...ctx}
					currentAgentName={currentAgentName}
					agents={agents}
					loadErrors={loadErrors}
				/>
			),
		});
		if (!selectedKey) {
			refocusTextarea();
			return;
		}

		if (selectedKey === DEFAULT_AGENT_ACTION) {
			if (config.agentProfile) {
				await withLoadingDialog(dialog, "Applying agent...", async () => {
					await onAgentProfileChange(null);
				});
				session.setActiveAgentName(null);
			}
			refocusTextarea();
			return;
		}

		const profile = agents.find(
			(agent) => agent.name.toLowerCase() === selectedKey,
		);
		if (!profile) {
			refocusTextarea();
			return;
		}
		if (profile.name !== currentAgentName) {
			await withLoadingDialog(dialog, "Applying agent...", async () => {
				await onAgentProfileChange({
					name: profile.name,
					systemPrompt: profile.systemPrompt,
					plugins: profile.plugins,
				});
			});
			session.setActiveAgentName(profile.name);
		}
		refocusTextarea();
	}, [
		dialog,
		config,
		termHeight,
		onAgentProfileChange,
		refocusTextarea,
		session,
	]);

	return openAgentSelector;
}
