import { useEffect, useMemo, useState } from "react";
import {
	buildSlashCommandRegistry,
	getVisibleSystemSlashCommands,
	getVisibleUserSlashCommands,
} from "../commands/slash-command-registry";
import type { TuiProps } from "../types";

export function useSlashCommands(input: {
	workflowSlashCommands: TuiProps["workflowSlashCommands"];
	loadAdditionalSlashCommands: TuiProps["loadAdditionalSlashCommands"];
	canFork: boolean;
	showClineAccountCommand: boolean;
}) {
	const {
		workflowSlashCommands,
		loadAdditionalSlashCommands,
		canFork,
		showClineAccountCommand,
	} = input;
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
			showClineAccountCommand,
		});
	}, [
		workflowSlashCommands,
		additionalSlashCommands,
		canFork,
		showClineAccountCommand,
	]);

	const systemCommands = useMemo(
		() => getVisibleSystemSlashCommands(registry),
		[registry],
	);
	const skillCommands = useMemo(
		() => getVisibleUserSlashCommands(registry),
		[registry],
	);

	return { registry, systemCommands, skillCommands };
}
