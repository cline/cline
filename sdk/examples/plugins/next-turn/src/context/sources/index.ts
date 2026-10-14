import type { HubFold } from "../../hub/fold";
import type { HubLink } from "../../hub/link";
import type { ContextSource } from "../source";
import { ClineSetupSource } from "./cline-setup";
import { historySource } from "./history";
import { hubBackedSource, suppliedSource } from "./hub";
import { RepoReader, repoSource } from "./repo";
import { gitSource, turnSource } from "./workspace";

export type ClineSources = {
	sources: ContextSource[];
	setup: ClineSetupSource;
	stop(): void;
};

/**
 * The Cline-first source set, before any connector: the turn, git,
 * the repository's commands, the person's Cline setup, their other chats, and
 * the hub's tasks. Status and a plan are absent unless supplied. Connectors append to
 * the same list.
 */
export function clineSources(
	link: HubLink,
	fold: () => HubFold,
	scope: { workspaceRoot?: string; cwd?: string },
	log?: (message: string, error?: unknown) => void,
	supplied: {
		status?: boolean;
		plan?: boolean;
		planSource?: ContextSource;
	} = {},
): ClineSources {
	const setup = new ClineSetupSource(link, scope, log);
	setup.start();
	return {
		setup,
		sources: [
			turnSource,
			gitSource,
			repoSource(new RepoReader()),
			setup,
			historySource(link, fold),
			hubBackedSource("tasks", link),
			suppliedSource("status", supplied.status === true, () =>
				link.availability(),
			),
			supplied.planSource ?? suppliedSource("plan", supplied.plan === true),
		],
		stop: () => setup.stop(),
	};
}
