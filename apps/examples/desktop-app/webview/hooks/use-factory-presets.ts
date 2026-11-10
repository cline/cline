"use client";

import { useCallback, useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import type {
	FactoryPreset,
	FactoryPresetSettings,
} from "@/lib/factory-presets";

export function useFactoryPresets() {
	const [presets, setPresets] = useState<FactoryPreset[]>([]);
	const [defaultPreset, setDefaultPreset] = useState<string>();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [loadAttempt, setLoadAttempt] = useState(0);
	const reload = useCallback(
		() => setLoadAttempt((attempt) => attempt + 1),
		[],
	);

	useEffect(() => {
		let active = true;
		setLoading(true);
		setError(null);
		void desktopClient
			.invoke<FactoryPresetSettings>("get_desktop_settings")
			.then((settings) => {
				if (!active) return;
				setPresets(settings.factoryPresets ?? []);
				setDefaultPreset(settings.factoryDefaultPreset);
			})
			.catch((cause: unknown) => {
				if (active)
					setError(
						cause instanceof Error
							? cause.message
							: "Unable to load workflows.",
					);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [loadAttempt]);

	return {
		presets,
		setPresets,
		defaultPreset,
		setDefaultPreset,
		loading,
		error,
		reload,
	};
}
