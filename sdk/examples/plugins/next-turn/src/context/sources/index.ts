import type { HubFold } from "../../hub/fold";
import type { HubLink, HubLinkScope } from "../../hub/link";
import type { Log } from "../../log";
import type { ContextSource } from "../source";
import { ClineSetupSource } from "./cline-setup";
import { historySource } from "./history";
import { hubBackedSource, suppliedSource } from "./hub";
import { repoSource } from "./repo";
import { gitSource, turnSource } from "./workspace";

export type ClineSources = {
	sources: ContextSource[];
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
	scope: HubLinkScope,
	log?: Log,
	supplied: {
		status?: boolean;
		plan?: boolean;
		planSource?: ContextSource;
	} = {},
): ClineSources {
	const setup = new ClineSetupSource(link, scope, log);
	setup.start();
	return {
		sources: [
			turnSource,
			gitSource,
			repoSource(),
			setup,
			historySource(link, fold),
			hubBackedSource("tasks", link, {
				displayName: "The task agenda",
				settingsToggle: "tasks",
			}),
			suppliedSource(
				"status",
				supplied.status === true,
				{
					displayName: "The Status Hub for this chat",
					settingsToggle: "status",
				},
				() => link.availability(),
			),
			supplied.planSource ??
				suppliedSource("plan", supplied.plan === true, {
					displayName: "The plan and the plan bank",
				}),
		],
		stop: () => setup.stop(),
	};
}
