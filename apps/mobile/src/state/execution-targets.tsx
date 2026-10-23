import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { createExpoSecureStoreAdapter } from "@/connection";
import {
	type CloudExecutionTarget,
	type ExecutionTargetSnapshot,
	ExecutionTargetStore,
} from "./execution-target-store";

interface ExecutionTargetsContextValue {
	store: ExecutionTargetStore;
	hydrated: boolean;
}

const ExecutionTargetsContext = createContext<ExecutionTargetsContextValue>({
	store: new ExecutionTargetStore(),
	hydrated: true,
});

let deviceStore: ExecutionTargetStore | undefined;
function getDeviceStore(): ExecutionTargetStore {
	deviceStore ??= new ExecutionTargetStore(createExpoSecureStoreAdapter());
	return deviceStore;
}

export function ExecutionTargetsProvider({
	children,
	store,
}: {
	children: ReactNode;
	store?: ExecutionTargetStore;
}) {
	const [value] = useState(() => store ?? getDeviceStore());
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => {
		void value
			.hydrate()
			.catch(() => {})
			.finally(() => setHydrated(true));
	}, [value]);
	return (
		<ExecutionTargetsContext.Provider value={{ store: value, hydrated }}>
			{children}
		</ExecutionTargetsContext.Provider>
	);
}

export interface UseExecutionTargets extends ExecutionTargetSnapshot {
	hydrated: boolean;
	saveCloudTarget(
		input: Omit<CloudExecutionTarget, "id" | "mode">,
	): Promise<CloudExecutionTarget>;
	saveCloudModel(modelId: string, organizationId?: string): Promise<void>;
	removeCloudTarget(id: string): Promise<void>;
	select(id: string): Promise<void>;
	store: ExecutionTargetStore;
}

export function useExecutionTargets(): UseExecutionTargets {
	const { store, hydrated } = useContext(ExecutionTargetsContext);
	const [snapshot, setSnapshot] = useState(() => store.get());
	useEffect(() => {
		setSnapshot(store.get());
		return store.subscribe(setSnapshot);
	}, [store]);
	return {
		...snapshot,
		hydrated,
		saveCloudTarget: (input) => store.saveCloudTarget(input),
		saveCloudModel: (modelId, organizationId) =>
			store.saveCloudModel(modelId, organizationId),
		removeCloudTarget: (id) => store.removeCloudTarget(id),
		select: (id) => store.select(id),
		store,
	};
}
