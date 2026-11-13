"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import type { FactoryLimits } from "@/lib/factory-limits";

type SupportedLimits = Extract<FactoryLimits, { supported: true }>;

/**
 * How much Factory work the Hub runs at once, whether new work is paused
 * (`limits.paused`, from a Hub that persists it), and the daily spending limit
 * (`limits.dailyCostUsd`, from a Hub that supports it). The Hub is the source
 * of truth; a change shows immediately and rolls back if the Hub rejects it.
 * `enabled: false` reads nothing, for a surface that may not need the limits.
 */
export function useFactoryLimits({
	enabled = true,
}: {
	enabled?: boolean;
} = {}) {
	const [limits, setLimits] = useState<FactoryLimits>();
	const [loading, setLoading] = useState(enabled);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Which setting the error belongs to, so each control shows only its own.
	const [errorFor, setErrorFor] = useState<
		"read" | "concurrency" | "dailyCostUsd" | null
	>(null);
	const latest = useRef(0);
	// Bumped by `reload`, after something else changed the Hub's limits.
	const [version, setVersion] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` re-reads after `reload`.
	useEffect(() => {
		if (!enabled) {
			setLoading(false);
			return;
		}
		let active = true;
		setLoading(true);
		void desktopClient
			.invoke<FactoryLimits>("factory_get_limits")
			.then((value) => {
				if (active) setLimits(value);
			})
			.catch((cause: unknown) => {
				if (!active) return;
				setErrorFor("read");
				setError(
					cause instanceof Error
						? cause.message
						: "Unable to read how much work runs at once.",
				);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [enabled, version]);

	/** Reads the limits again (after a settings reset). */
	const reload = useCallback(() => setVersion((value) => value + 1), []);

	const update = useCallback(
		async (
			change: Partial<
				Pick<SupportedLimits, "concurrency" | "dailyCostUsd" | "paused">
			>,
			failure: string,
		) => {
			const previous = limits;
			// A change needs a Hub that reported limits; there is nothing to
			// show for one that has not answered or predates them.
			if (!previous?.supported && change.concurrency === undefined) return;
			const attempt = ++latest.current;
			setLimits({
				...(previous?.supported
					? previous
					: { supported: true, concurrency: change.concurrency ?? 1 }),
				...change,
			});
			setSaving(true);
			setError(null);
			setErrorFor(null);
			try {
				const saved = await desktopClient.invoke<FactoryLimits>(
					"factory_set_limits",
					change,
				);
				if (attempt === latest.current) setLimits(saved);
			} catch (cause) {
				if (attempt !== latest.current) return;
				setLimits(previous);
				setErrorFor(
					change.dailyCostUsd !== undefined ? "dailyCostUsd" : "concurrency",
				);
				setError(cause instanceof Error ? cause.message : failure);
			} finally {
				if (attempt === latest.current) setSaving(false);
			}
		},
		[limits],
	);

	const setConcurrency = useCallback(
		(concurrency: number) =>
			update({ concurrency }, "Unable to change how much work runs at once."),
		[update],
	);

	/** `null` removes the daily spending limit. Applies immediately. */
	const setDailyCostUsd = useCallback(
		(dailyCostUsd: number | null) =>
			update({ dailyCostUsd }, "Unable to change the daily spending limit."),
		[update],
	);

	/** Pauses or resumes new work. Applies immediately. */
	const setPaused = useCallback(
		(paused: boolean) =>
			update(
				{ paused },
				paused ? "Unable to pause new work." : "Unable to resume new work.",
			),
		[update],
	);

	return {
		limits,
		loading,
		saving,
		error,
		errorFor,
		setConcurrency,
		setDailyCostUsd,
		setPaused,
		reload,
	};
}
