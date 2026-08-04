import { useEffect, useMemo, useState } from "react";
import {
	buildSlashCommandRegistry,
	getInvokableUserSlashCommands,
	getVisibleSystemSlashCommands,
	getVisibleUserSlashCommands,
} from "../commands/slash-command-registry";
import type { TuiProps } from "../types";

export function useSlashCommands(input: {
	workflowSlashCommands: TuiProps["workflowSlashCommands"];
	loadAdditionalSlashCommands: TuiProps["loadAdditionalSlashCommands"];
	canFork: boolean;
}) {
	const { workflowSlashCommands, loadAdditionalSlashCommands, canFork } = input;
	const [additionalSlashCommands, setAdditionalSlashCommands] = useState<
		TuiProps["workflowSlashCommands"] | undefined
	>(loadAdditionalSlashCommands ? [] : undefined);

	useEffect(() => {
		if (!loadAdditionalSlashCommands) {
			setAdditionalSlashCommands(undefined);
			return;
		}
		let cancelled = false;
		void loadAdditionalSlashCommands()
			.then((commands) => {
				if (!cancelled) {
					setAdditionalSlashCommands(commands);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setAdditionalSlashCommands([]);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [loadAdditionalSlashCommands]);

	const registry = useMemo(() => {
		return buildSlashCommandRegistry({
			workflowSlashCommands,
			additionalSlashCommands,
			canFork,
		});
	}, [workflowSlashCommands, additionalSlashCommands, canFork]);

	const systemCommands = useMemo(
		() => getVisibleSystemSlashCommands(registry),
		[registry],
	);
	const skillCommands = useMemo(
		() => getVisibleUserSlashCommands(registry),
		[registry],
	);
	const invokableSkillCommands = useMemo(
		() => getInvokableUserSlashCommands(registry),
		[registry],
	);

	return { registry, systemCommands, skillCommands, invokableSkillCommands };
}
