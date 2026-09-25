"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";

export type TaskTerminal = {
	id: string;
	title: string;
	cwd: string;
};

/**
 * The shells that belong to one task. The sidecar owns the processes and
 * groups them by `scopeId`; this hook mirrors that list, follows exits, and
 * moves the group when the scope key changes (a fresh thread only learns its
 * session id after the first prompt).
 */
export function useTaskTerminals(scopeId: string) {
	const [terminals, setTerminals] = useState<TaskTerminal[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);
	const scopeRef = useRef<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const previousScope = scopeRef.current;
		scopeRef.current = scopeId;
		const load = async () => {
			if (previousScope && previousScope !== scopeId) {
				await desktopClient
					.invoke("terminal_rescope", {
						fromScopeId: previousScope,
						toScopeId: scopeId,
					})
					.catch(() => undefined);
			}
			const result = await desktopClient.invoke<{ terminals: TaskTerminal[] }>(
				"terminal_list",
				{ scopeId },
			);
			if (cancelled) return;
			const list = Array.isArray(result?.terminals) ? result.terminals : [];
			setTerminals(list);
			setActiveId((current) =>
				current && list.some((terminal) => terminal.id === current)
					? current
					: (list.at(-1)?.id ?? null),
			);
		};
		void load()
			.catch(() => undefined)
			.finally(() => {
				if (!cancelled) setLoaded(true);
			});
		return () => {
			cancelled = true;
		};
	}, [scopeId]);

	useEffect(
		() =>
			desktopClient.subscribe("terminal_exit", (payload) => {
				const id = (payload as { id?: unknown } | null)?.id;
				if (typeof id !== "string") return;
				setTerminals((current) =>
					current.filter((terminal) => terminal.id !== id),
				);
			}),
		[],
	);

	// Keep a valid selection when the active shell exits or is closed.
	useEffect(() => {
		if (activeId && !terminals.some((terminal) => terminal.id === activeId)) {
			setActiveId(terminals.at(-1)?.id ?? null);
		}
	}, [activeId, terminals]);

	const openTerminal = useCallback(
		async (cwd: string): Promise<TaskTerminal> => {
			const info = await desktopClient.invoke<TaskTerminal>("terminal_open", {
				scopeId,
				cwd,
			});
			setTerminals((current) => [...current, info]);
			setActiveId(info.id);
			return info;
		},
		[scopeId],
	);

	const closeTerminal = useCallback(async (id: string) => {
		setTerminals((current) => current.filter((terminal) => terminal.id !== id));
		await desktopClient.invoke("terminal_close", { id }).catch(() => undefined);
	}, []);

	return {
		terminals,
		activeId,
		setActiveId,
		loaded,
		openTerminal,
		closeTerminal,
	};
}
