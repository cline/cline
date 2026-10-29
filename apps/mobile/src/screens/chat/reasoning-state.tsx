/**
 * Per-session memory for the reasoning block's disclosure state.
 *
 * Reasoning is collapsed by default, but a user's explicit disclosure choice
 * must survive FlatList virtualization. It cannot live only in the disclosure's
 * own state because a row scrolled far off-screen can unmount.
 *
 * The store is a ref-held `Map` under a provider rather than module state, so it
 * is scoped to one mounted chat session and two tests never leak into each other.
 */

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";

interface FlagStore {
	get(key: string): boolean | undefined;
	set(key: string, value: boolean): void;
}

const ReasoningStateContext = createContext<FlagStore | undefined>(undefined);

/** Consumed search requests survive virtualized tool-row remounts. */
export function useDisclosureFlags() {
	return useContext(ReasoningStateContext);
}

export function ReasoningStateProvider({ children }: { children: ReactNode }) {
	const flags = useRef(new Map<string, boolean>());
	const store = useMemo<FlagStore>(
		() => ({
			get: (key) => flags.current.get(key),
			set: (key, value) => {
				flags.current.set(key, value);
			},
		}),
		[],
	);
	return (
		<ReasoningStateContext.Provider value={store}>
			{children}
		</ReasoningStateContext.Provider>
	);
}

/**
 * A boolean remembered for `key` across unmounts within the session.
 *
 * Without a provider it degrades to plain component state — a block rendered
 * outside a chat screen still toggles, it just forgets on unmount.
 */
export function useRememberedFlag(
	key: string,
	defaultValue: boolean,
): [boolean, (value: boolean) => void] {
	const store = useContext(ReasoningStateContext);
	const [local, setLocal] = useState(() => store?.get(key) ?? defaultValue);
	const set = useCallback(
		(value: boolean) => {
			store?.set(key, value);
			setLocal(value);
		},
		[key, store],
	);
	return [local, set];
}
