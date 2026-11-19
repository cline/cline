"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

type LeaveGuard = {
	hasChanges: () => boolean;
	requestLeave: (proceed: () => void, onCancel?: () => void) => void;
};

/** The editors that currently have something to lose, wherever they render. */
export type UnsavedChangesRegistry = Set<LeaveGuard>;

const UnsavedChangesContext = createContext<UnsavedChangesRegistry | null>(
	null,
);

function confirmWith(
	registry: UnsavedChangesRegistry,
	proceed: () => void,
	onCancel?: () => void,
	confirmed = new Set<LeaveGuard>(),
) {
	for (const guard of registry) {
		if (!confirmed.has(guard) && guard.hasChanges()) {
			guard.requestLeave(() => {
				confirmed.add(guard);
				confirmWith(registry, proceed, onCancel, confirmed);
			}, onCancel);
			return;
		}
	}
	proceed();
}

/**
 * For the app shell: a registry to hand to the provider, and a function that
 * runs a navigation only after any unsaved draft has been discarded.
 */
export function useUnsavedChangesRegistry() {
	const registry = useMemo<UnsavedChangesRegistry>(() => new Set(), []);
	const confirmLeave = useCallback(
		(proceed: () => void, onCancel?: () => void) =>
			confirmWith(registry, proceed, onCancel),
		[registry],
	);
	return { registry, confirmLeave };
}

export function UnsavedChangesProvider({
	registry,
	children,
}: {
	registry: UnsavedChangesRegistry;
	children: ReactNode;
}) {
	return (
		<UnsavedChangesContext.Provider value={registry}>
			{children}
		</UnsavedChangesContext.Provider>
	);
}

/** Run a navigation that leaves the current page, asking first when a draft would be lost. */
export function useLeaveConfirmation(): LeaveGuard["requestLeave"] {
	const registry = useContext(UnsavedChangesContext);
	return useCallback(
		(proceed: () => void, onCancel?: () => void) => {
			if (registry) confirmWith(registry, proceed, onCancel);
			else proceed();
		},
		[registry],
	);
}

/**
 * For an editor: ask before anything navigates away from unsaved changes.
 * Render the returned dialog state with `DiscardChangesDialog`.
 */
export function useUnsavedChangesGuard(hasChanges: () => boolean) {
	const registry = useContext(UnsavedChangesContext);
	const hasChangesRef = useRef(hasChanges);
	hasChangesRef.current = hasChanges;
	// Set while a confirmed leave runs, so nested checks do not ask twice.
	const leaving = useRef(false);
	// One confirmation represents one navigation intent. Cancel competing
	// requests so async callers can settle while the first dialog stays open.
	const pendingLeave = useRef<{
		proceed: () => void;
		onCancel?: () => void;
	} | null>(null);
	const [isConfirming, setIsConfirming] = useState(false);

	const leave = useCallback((proceed: () => void) => {
		leaving.current = true;
		try {
			proceed();
		} finally {
			leaving.current = false;
		}
	}, []);
	const requestLeave = useCallback(
		(proceed: () => void, onCancel?: () => void) => {
			if (pendingLeave.current) {
				onCancel?.();
				return;
			}
			if (leaving.current || !hasChangesRef.current()) {
				leave(proceed);
				return;
			}
			pendingLeave.current = { proceed, onCancel };
			setIsConfirming(true);
		},
		[leave],
	);
	const confirm = useCallback(() => {
		const pending = pendingLeave.current;
		pendingLeave.current = null;
		setIsConfirming(false);
		if (pending) leave(pending.proceed);
	}, [leave]);
	const cancel = useCallback(() => {
		const pending = pendingLeave.current;
		pendingLeave.current = null;
		setIsConfirming(false);
		pending?.onCancel?.();
	}, []);

	useEffect(() => {
		const guard: LeaveGuard = {
			hasChanges: () => !leaving.current && hasChangesRef.current(),
			requestLeave,
		};
		registry?.add(guard);
		return () => {
			registry?.delete(guard);
			const pending = pendingLeave.current;
			pendingLeave.current = null;
			pending?.onCancel?.();
		};
	}, [registry, requestLeave]);

	return { requestLeave, isConfirming, confirm, cancel };
}

export type UnsavedChangesGuard = ReturnType<typeof useUnsavedChangesGuard>;
