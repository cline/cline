"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { desktopClient } from "@/lib/desktop-client";

/** Desktop-app-only preferences persisted by the sidecar. */
export type DesktopAppSettings = {
	cloudSessionsEnabled: boolean;
};

const DEFAULT_SETTINGS: DesktopAppSettings = {
	cloudSessionsEnabled: false,
};

type DesktopSettingsContextValue = {
	settings: DesktopAppSettings;
	loaded: boolean;
	setCloudSessionsEnabled: (enabled: boolean) => Promise<void>;
};

const DesktopSettingsContext = createContext<DesktopSettingsContextValue>({
	settings: DEFAULT_SETTINGS,
	loaded: false,
	setCloudSessionsEnabled: async () => {},
});

function parseSettings(payload: unknown): DesktopAppSettings {
	if (!payload || typeof payload !== "object") {
		return { ...DEFAULT_SETTINGS };
	}
	const record = payload as Record<string, unknown>;
	return {
		cloudSessionsEnabled:
			typeof record.cloudSessionsEnabled === "boolean"
				? record.cloudSessionsEnabled
				: DEFAULT_SETTINGS.cloudSessionsEnabled,
	};
}

export function DesktopSettingsProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const [settings, setSettings] = useState<DesktopAppSettings>(
		() => DEFAULT_SETTINGS,
	);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void desktopClient
			.invoke<DesktopAppSettings>("get_desktop_app_settings")
			.then((payload) => {
				if (!cancelled) {
					setSettings(parseSettings(payload));
				}
			})
			.catch(() => {
				// Defaults keep the app functional; the toggle can retry.
			})
			.finally(() => {
				if (!cancelled) {
					setLoaded(true);
				}
			});
		const unsubscribe = desktopClient.subscribe(
			"desktop_app_settings",
			(payload) => {
				setSettings(parseSettings(payload));
			},
		);
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	const setCloudSessionsEnabled = useCallback(async (enabled: boolean) => {
		const next = await desktopClient.invoke<DesktopAppSettings>(
			"update_desktop_app_settings",
			{ cloudSessionsEnabled: enabled },
		);
		setSettings(parseSettings(next));
	}, []);

	const value = useMemo(
		() => ({ settings, loaded, setCloudSessionsEnabled }),
		[settings, loaded, setCloudSessionsEnabled],
	);

	return (
		<DesktopSettingsContext.Provider value={value}>
			{children}
		</DesktopSettingsContext.Provider>
	);
}

export function useDesktopSettings(): DesktopSettingsContextValue {
	return useContext(DesktopSettingsContext);
}
