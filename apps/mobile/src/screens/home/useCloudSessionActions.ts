import { useCallback, useEffect, useRef } from "react";
import { CloudSessionGateway, cloudAuthStore } from "@/cloud";
import { cloudEnv } from "@/config/env";
import { cloudLaunches } from "@/connection/cloud-launches";
import { asRemoteSessionId } from "@/session";
import { useEndpoints } from "@/state/endpoints";
import type { SessionRow } from "./session-rows";

/** Mutate only the exact outer Cloud session, with its recorded account scope. */
export function useCloudSessionActions(
	onRefresh: () => void,
	onClosed?: (key: string) => void,
) {
	const { save, remove } = useEndpoints();
	const mounted = useRef(true);
	const callbacks = useRef({ onRefresh, onClosed });
	callbacks.current = { onRefresh, onClosed };
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const publish = useCallback((closedKey?: string) => {
		if (!mounted.current) return;
		callbacks.current.onRefresh();
		if (mounted.current && closedKey !== undefined)
			callbacks.current.onClosed?.(closedKey);
	}, []);
	const gatewayFor = (row: SessionRow) => {
		if (row.descriptor.mode !== "cloud" || !row.descriptor.remoteSessionId)
			throw new Error("Only Cloud sessions can be changed here.");
		return new CloudSessionGateway({
			apiBaseUrl: row.descriptor.apiBaseUrl ?? cloudEnv.apiBaseUrl,
			getAccessToken: () => cloudAuthStore.getValidAccessToken(),
			...(row.descriptor.organizationId
				? { organizationId: row.descriptor.organizationId }
				: {}),
		});
	};
	return {
		onStopWorkspace: async (row: SessionRow) => {
			const gateway = gatewayFor(row);
			await gateway.suspendRemoteSession(
				asRemoteSessionId(row.descriptor.remoteSessionId!),
			);
			cloudLaunches.remove(row.key);
			publish(row.key);
		},
		onRenameSession: async (row: SessionRow, title: string) => {
			const gateway = gatewayFor(row);
			await gateway.updateTitle(
				asRemoteSessionId(row.descriptor.remoteSessionId!),
				title,
			);
			// The server mutation already succeeded. Don't invite a duplicate retry
			// just because local persistence failed (the next refresh heals the label).
			await save({
				...row.descriptor,
				label: title,
				sessionTitle: title,
			}).catch(() => {});
			publish();
		},
		onDeleteSession: async (row: SessionRow) => {
			const gateway = gatewayFor(row);
			await gateway.deleteRemoteSession(
				asRemoteSessionId(row.descriptor.remoteSessionId!),
			);
			await remove(row.key).catch(() => {});
			cloudLaunches.remove(row.key);
			publish(row.key);
		},
	};
}
