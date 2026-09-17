"use client";

import { useCallback, useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";

export type FeatureFlagValue =
	| string
	| number
	| boolean
	| null
	| { [key: string]: FeatureFlagValue }
	| FeatureFlagValue[];

type FeatureFlagsSnapshot = {
	flags: Record<string, FeatureFlagValue>;
};

export type FeatureFlagsState = {
	flags: Record<string, FeatureFlagValue>;
	loaded: boolean;
	refresh: () => Promise<void>;
};

export function useFeatureFlags(): FeatureFlagsState {
	const [flags, setFlags] = useState<Record<string, FeatureFlagValue>>({});
	const [loaded, setLoaded] = useState(false);

	const load = useCallback(async () => {
		try {
			const snapshot =
				await desktopClient.invoke<FeatureFlagsSnapshot>("get_feature_flags");
			setFlags(snapshot?.flags ?? {});
		} catch {
			// Sidecar down or still starting. Leave the previous values in place;
			// every consumer falls back to `false`, matching the registry default
			// for a flag nobody has been opted into.
		} finally {
			setLoaded(true);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	return { flags, loaded, refresh: load };
}

export function isFeatureEnabled(
	flags: Record<string, FeatureFlagValue>,
	flag: string,
): boolean {
	return flags[flag] === true;
}
