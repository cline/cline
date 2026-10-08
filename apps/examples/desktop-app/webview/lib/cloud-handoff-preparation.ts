import type { HandoffGitPreview } from "../../sidecar/cloud-handoff-git";
import type { HandoffPreflight } from "./cloud-handoff";

export type HandoffPreparation =
	| HandoffPreflight
	| { gitPreparation: HandoffGitPreview };

export async function prepareHandoffWithGit(options: {
	inspect: () => Promise<HandoffPreparation>;
	confirm: (plan: HandoffGitPreview) => Promise<boolean>;
	apply: (id: string) => Promise<unknown>;
}): Promise<HandoffPreflight | null> {
	const initial = await options.inspect();
	if (!("gitPreparation" in initial)) return initial;
	if (!(await options.confirm(initial.gitPreparation))) return null;
	await options.apply(initial.gitPreparation.id);
	const prepared = await options.inspect();
	if ("gitPreparation" in prepared)
		throw new Error(
			"The repository still needs preparation. Run /cloud again to review it; nothing will be published automatically.",
		);
	return prepared;
}
