import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { Appearance, useColorScheme } from "react-native";
import {
	createExpoSecureStoreAdapter,
	type EndpointPersistence,
} from "@/connection";
import { darkTheme, lightTheme, ThemeProvider } from "@/ui/theme";

export type AppearancePreference = "system" | "light" | "dark";
const STORAGE_KEY = "cline.mobile.appearance";
const deviceStorage = createExpoSecureStoreAdapter();
interface AppearanceContextValue {
	preference: AppearancePreference;
	hydrated: boolean;
	saving: boolean;
	setPreference(preference: AppearancePreference): Promise<void>;
}
const AppearanceContext = createContext<AppearanceContextValue>({
	preference: "system",
	hydrated: true,
	saving: false,
	setPreference: async () => {},
});

export function AppearanceProvider({
	children,
	storage = deviceStorage,
}: {
	children: ReactNode;
	storage?: Pick<EndpointPersistence, "getItem" | "setItem">;
}) {
	const [preference, setValue] = useState<AppearancePreference>("system");
	const [hydrated, setHydrated] = useState(false);
	const [saving, setSaving] = useState(false);
	const writing = useRef(false);
	const systemScheme = useColorScheme();
	useEffect(() => {
		let active = true;
		void storage
			.getItem(STORAGE_KEY)
			.then((value) => {
				if (active && (value === "light" || value === "dark")) {
					Appearance.setColorScheme(value);
					setValue(value);
				}
			})
			.catch(() => {})
			.finally(() => {
				if (active) setHydrated(true);
			});
		return () => {
			active = false;
		};
	}, [storage]);
	const setPreference = async (next: AppearancePreference) => {
		if (writing.current) return;
		writing.current = true;
		setSaving(true);
		try {
			await storage.setItem(STORAGE_KEY, next);
			// Native alerts, pickers and keyboards must follow the same override.
			Appearance.setColorScheme(next === "system" ? "unspecified" : next);
			setValue(next);
		} finally {
			writing.current = false;
			setSaving(false);
		}
	};
	const mode = preference === "system" ? systemScheme : preference;
	return (
		<AppearanceContext.Provider
			value={{ preference, hydrated, saving, setPreference }}
		>
			<ThemeProvider value={mode === "dark" ? darkTheme : lightTheme}>
				{children}
			</ThemeProvider>
		</AppearanceContext.Provider>
	);
}

export function useAppearance() {
	return useContext(AppearanceContext);
}
