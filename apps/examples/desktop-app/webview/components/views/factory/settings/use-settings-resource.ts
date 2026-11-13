"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	factorySettingsErrorMessage,
	isUnavailable,
} from "@/lib/factory-settings-client";
import { FS_SHELL } from "@/lib/factory-settings-copy/shell";

/**
 * One read for a settings page: loading, the value, "not available" (the
 * command is missing or its Hub is too old) or an error, and a reload.
 * `set` replaces the value with a command's reply (a save returns the new
 * state).
 */
export type SettingsResource<T> = {
	status: "loading" | "ready" | "unavailable" | "error";
	data: T | undefined;
	/** Why it is unavailable: this build lacks it, or the Hub is too old. */
	unavailable?: "build" | "hub";
	error?: string;
	reload: () => void;
	set: (data: T) => void;
};

export function useSettingsResource<T>(
	load: () => Promise<T>,
	deps: readonly unknown[],
	{ enabled = true }: { enabled?: boolean } = {},
): SettingsResource<T> {
	const [state, setState] = useState<
		Omit<SettingsResource<T>, "reload" | "set">
	>({ status: enabled ? "loading" : "ready", data: undefined });
	const [attempt, setAttempt] = useState(0);
	const loadRef = useRef(load);
	loadRef.current = load;
	// biome-ignore lint/correctness/useExhaustiveDependencies: `deps` names what the read depends on.
	useEffect(() => {
		if (!enabled) return;
		let active = true;
		setState((current) => ({ ...current, status: "loading" }));
		loadRef.current().then(
			(data) => {
				if (active) setState({ status: "ready", data });
			},
			(cause: unknown) => {
				if (!active) return;
				setState(
					isUnavailable(cause)
						? {
								status: "unavailable",
								data: undefined,
								unavailable: cause.reason,
							}
						: {
								status: "error",
								data: undefined,
								error: factorySettingsErrorMessage(cause, FS_SHELL.loadFailed),
							},
				);
			},
		);
		return () => {
			active = false;
		};
	}, [enabled, attempt, ...deps]);
	return {
		...state,
		reload: useCallback(() => setAttempt((value) => value + 1), []),
		set: useCallback((data: T) => setState({ status: "ready", data }), []),
	};
}

/**
 * Saves made from rows outside the default workflow: a command per change,
 * "Saved" in the header when it lands, and the error under the row that made
 * it when it fails (the caller puts its control back).
 */
export function useRowSaves(saved: () => void) {
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState<string>();
	const save = useCallback(
		async <T>(
			row: string,
			operation: () => Promise<T>,
		): Promise<{ ok: true; value: T } | { ok: false }> => {
			setBusy(row);
			setErrors(({ [row]: _cleared, ...rest }) => rest);
			try {
				const value = await operation();
				saved();
				return { ok: true, value };
			} catch (cause) {
				setErrors((current) => ({
					...current,
					[row]: isUnavailable(cause)
						? cause.reason === "hub"
							? FS_SHELL.hubTooOld
							: FS_SHELL.notAvailable
						: factorySettingsErrorMessage(cause, FS_SHELL.saveFailed),
				}));
				return { ok: false };
			} finally {
				setBusy((current) => (current === row ? undefined : current));
			}
		},
		[saved],
	);
	return {
		save,
		/** The row whose save is in flight. */
		busy,
		errorFor: (row: string): string | undefined => errors[row],
	};
}
