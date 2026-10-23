/**
 * Shared helpers for the screen smoke tests: a fake {@link UseSessionConnection}
 * (no socket) and a tree text search.
 */

import type { ReactTestInstance } from "react-test-renderer";
import type { UseSessionConnection } from "@/connection";
import {
	createSessionState,
	type SessionViewModel,
	selectViewModel,
} from "@/session";

export function emptyView(): SessionViewModel {
	return selectViewModel(createSessionState());
}

export function fakeConnection(
	overrides: Partial<UseSessionConnection> = {},
): UseSessionConnection {
	return {
		view: overrides.view ?? emptyView(),
		status: overrides.status ?? { phase: "ready" },
		sendInput: overrides.sendInput ?? (async () => {}),
		abort: overrides.abort ?? (async () => {}),
		respondApproval: overrides.respondApproval ?? (async () => {}),
		respondQuestion: overrides.respondQuestion ?? (async () => {}),
		retrySend: overrides.retrySend ?? (async () => {}),
		removePendingPrompt: overrides.removePendingPrompt ?? (async () => {}),
		updatePendingPrompt: overrides.updatePendingPrompt ?? (async () => {}),
		updateModel: overrides.updateModel ?? (async () => {}),
		listModelCatalog:
			overrides.listModelCatalog ??
			(async () => ({ providers: [], modelsByProvider: {} })),
		listCheckpoints: overrides.listCheckpoints ?? (async () => []),
		forkAtCheckpoint:
			overrides.forkAtCheckpoint ?? (async () => "fork-session"),
		reconnect: overrides.reconnect ?? (async () => {}),
		setApprovalPolicy: overrides.setApprovalPolicy ?? (() => {}),
		dispose: overrides.dispose ?? (() => {}),
	};
}

/** Concatenated string content of every text node in the tree. */
export function allText(root: ReactTestInstance): string {
	return root
		.findAll(() => true, { deep: true })
		.flatMap((node) => {
			const children = node.props.children;
			if (typeof children === "string") {
				return [children];
			}
			if (Array.isArray(children)) {
				return children.filter((c): c is string => typeof c === "string");
			}
			return [];
		})
		.join(" ");
}

/** True if any text node anywhere contains `needle`. */
export function containsText(root: ReactTestInstance, needle: string): boolean {
	return allText(root).includes(needle);
}

export function findByLabel(
	root: ReactTestInstance,
	label: string,
): ReactTestInstance | undefined {
	return root
		.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityLabel === label,
		)
		.at(-1);
}

export function getByLabel(
	root: ReactTestInstance,
	label: string,
): ReactTestInstance {
	const node = findByLabel(root, label);
	if (!node) throw new Error(`No host node labelled "${label}"`);
	return node;
}
