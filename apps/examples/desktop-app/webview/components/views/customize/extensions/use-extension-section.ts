import { useCallback, useEffect, useMemo, useState } from "react";
import {
	commitExtensionInventoryResponse,
	filterBuiltinInventory,
	subscribeToExtensionInventoryInvalidation,
	type UserInstructionListsResponse,
} from "@/lib/extension-inventory";
import { useExtensionInventory } from "@/lib/use-extension-inventory";
import { EMPTY_INVENTORY } from "./extension-section-shared";

/** Category actions share inventory publication while keeping action errors local. */
export function useExtensionSection(
	onInventoryChanged?: () => void,
	includeBuiltinItems = true,
) {
	const {
		inventory,
		loading,
		error,
		refresh: refreshInventory,
	} = useExtensionInventory();
	const visibleInventory = useMemo(
		() =>
			filterBuiltinInventory(inventory ?? EMPTY_INVENTORY, includeBuiltinItems),
		[inventory, includeBuiltinItems],
	);
	const [actionError, setError] = useState<string | null>(null);
	// Settings and other sections clear stale action errors just as local refresh does.
	useEffect(
		() => subscribeToExtensionInventoryInvalidation(() => setError(null)),
		[],
	);
	const refresh = useCallback(
		async (force = false) => {
			setError(null);
			const refreshed = await refreshInventory(force);
			if (force && refreshed) onInventoryChanged?.();
		},
		[refreshInventory, onInventoryChanged],
	);
	const applyResponse = useCallback(
		(response: Partial<UserInstructionListsResponse>) => {
			commitExtensionInventoryResponse(response);
			onInventoryChanged?.();
		},
		[onInventoryChanged],
	);
	return {
		inventory: visibleInventory,
		loading,
		/** The message to show: a failed action outranks a failed load. */
		error: actionError ?? error,
		loadError: error,
		actionError,
		setError,
		refresh,
		applyResponse,
	};
}
