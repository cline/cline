import { IconButton } from "@cline/ui";
import { RefreshCw } from "lucide-react";
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

type Refresh = () => Promise<unknown>;
const CustomizeRefreshContext = createContext<{
	register: (refresh: Refresh) => () => void;
	refresh: Refresh;
	refreshing: boolean;
} | null>(null);

/** Combine the displayed categories' refresh routines in the Manage heading. */
export function CustomizeRefreshProvider({
	children,
	enabled,
}: {
	children: ReactNode;
	enabled: boolean;
}) {
	const handlers = useRef(new Set<Refresh>());
	const pending = useRef(false);
	const [refreshing, setRefreshing] = useState(false);
	const register = useCallback((refresh: Refresh) => {
		handlers.current.add(refresh);
		return () => {
			handlers.current.delete(refresh);
		};
	}, []);
	const refresh = useCallback(async () => {
		if (pending.current) return;
		pending.current = true;
		setRefreshing(true);
		try {
			// Each category retains its own error handling and cached content.
			await Promise.allSettled(
				[...handlers.current].map((handler) => handler()),
			);
		} finally {
			pending.current = false;
			setRefreshing(false);
		}
	}, []);
	const value = useMemo(
		() => (enabled ? { register, refresh, refreshing } : null),
		[enabled, register, refresh, refreshing],
	);
	return (
		<CustomizeRefreshContext.Provider value={value}>
			{children}
		</CustomizeRefreshContext.Provider>
	);
}

/** Register a category refresh and report whether its local button is replaced. */
export function useCustomizeRefresh(refresh: Refresh) {
	const context = useContext(CustomizeRefreshContext);
	const register = context?.register;
	useEffect(() => register?.(refresh), [register, refresh]);
	return context !== null;
}

export function CustomizeRefreshButton() {
	const context = useContext(CustomizeRefreshContext);
	if (!context) return null;
	return (
		<IconButton
			aria-label="Refresh customizations"
			disabled={context.refreshing}
			onClick={() => void context.refresh()}
			size="sm"
			tone="neutral"
			type="button"
			variant="ghost"
			icon={RefreshCw}
			loading={context.refreshing}
			loadingIcon={RefreshCw}
		/>
	);
}
