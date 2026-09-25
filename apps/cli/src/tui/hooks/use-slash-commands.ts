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
	subscribeAdditionalSlashCommands: TuiProps["subscribeAdditionalSlashCommands"];
	canFork: boolean;
}) {
	const {
		workflowSlashCommands,
		loadAdditionalSlashCommands,
		subscribeAdditionalSlashCommands,
		canFork,
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
		let requestId = 0;
		const refresh = () => {
			const id = ++requestId;
			void loadAdditionalSlashCommands()
				.then((commands) => {
					if (!cancelled && id === requestId) {
						setAdditionalSlashCommands(commands);
					}
				})
				.catch(() => {
					if (!cancelled && id === requestId) {
						setAdditionalSlashCommands([]);
					}
				});
		};
		refresh();
		let unsubscribe: (() => void) | undefined;
		void subscribeAdditionalSlashCommands?.(refresh)
			.then((stop) => {
				if (cancelled) stop();
				else unsubscribe = stop;
			})
			.catch(() => {});
		return () => {
			unsubscribe?.();
			cancelled = true;
		};
	}, [loadAdditionalSlashCommands, subscribeAdditionalSlashCommands]);

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
