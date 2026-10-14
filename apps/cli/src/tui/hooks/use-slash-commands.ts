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
		let publishedRequestId = 0;
		let refreshRetry: ReturnType<typeof setTimeout> | undefined;
		let subscribeRetry: ReturnType<typeof setTimeout> | undefined;
		let refreshDelay = 1000;
		let subscribeDelay = 1000;
		const refresh = async () => {
			if (cancelled) return;
			clearTimeout(refreshRetry);
			const id = ++requestId;
			try {
				const commands = await loadAdditionalSlashCommands();
				if (!cancelled && id > publishedRequestId) {
					// A newer pending/failed request must not discard a usable catalog.
					publishedRequestId = id;
					if (id === requestId) refreshDelay = 1000;
					setAdditionalSlashCommands(commands);
				}
			} catch {
				if (!cancelled && id === requestId) {
					// Keep the last catalog visible while the runtime reconnects.
					refreshRetry = setTimeout(() => {
						void refresh();
					}, refreshDelay);
					refreshDelay = Math.min(refreshDelay * 2, 30_000);
				}
			}
		};
		void refresh();
		let unsubscribe: (() => void) | undefined;
		const subscribe = async () => {
			if (cancelled || !subscribeAdditionalSlashCommands) return;
			try {
				const stop = await subscribeAdditionalSlashCommands(() => {
					void refresh();
				});
				if (cancelled) stop();
				else {
					unsubscribe = stop;
					// Catch any catalog change missed before subscription was established.
					void refresh();
				}
			} catch {
				if (!cancelled) {
					subscribeRetry = setTimeout(() => {
						void subscribe();
					}, subscribeDelay);
					subscribeDelay = Math.min(subscribeDelay * 2, 30_000);
				}
			}
		};
		void subscribe();
		return () => {
			cancelled = true;
			clearTimeout(refreshRetry);
			clearTimeout(subscribeRetry);
			unsubscribe?.();
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
