import { useCallback, useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import {
	commitMcpServersResponse,
	type McpServer,
	type McpServersResponse,
} from "@/lib/extension-inventory";
import { useMcpInventory } from "@/lib/use-mcp-inventory";
import type { McpActionError, McpServerUpsertInput } from "./mcp-types";

/** The hub queues MCP changes and OAuth, so these calls have no client deadline. */
const HUB_QUEUED = { timeoutMs: null };

type McpServersOptions = {
	initialServers?: McpServer[];
	onInventoryChanged?: () => void;
	onResponse?: (response: McpServersResponse) => void;
	onActionError?: (serverName: string) => void;
	/** A server was created or updated; `previousName` is set when it existed before. */
	onServerSaved?: (name: string, previousName?: string) => void;
};

/** Shared inventory and mutations for the list, detail page, and editor. */
export function useMcpServers(options: McpServersOptions = {}) {
	// Inline page callbacks should not restart inventory subscriptions or fetches.
	const callbacks = useRef(options);
	callbacks.current = options;
	const {
		response,
		loading: isLoading,
		error: inventoryError,
		refresh,
	} = useMcpInventory();
	const servers = response?.servers ?? options.initialServers ?? [];
	const lastDisplayedResponse = useRef<McpServersResponse | null>(null);
	const [serverActionErrors, setServerActionErrors] = useState<
		Record<string, McpActionError>
	>({});
	const busyServers = useRef(new Set<string>());
	const [busyServerNames, setBusyServerNames] = useState(busyServers.current);
	const [authorizingServerName, setAuthorizingServerName] = useState<
		string | null
	>(null);
	const displayResponse = useCallback((response: McpServersResponse) => {
		lastDisplayedResponse.current = response;
		callbacks.current.onResponse?.(response);
		callbacks.current.onInventoryChanged?.();
	}, []);
	useEffect(() => {
		if (!response || response === lastDisplayedResponse.current) return;
		displayResponse(response);
		setServerActionErrors({});
	}, [response, displayResponse]);

	const applyResponse = useCallback(
		(response: McpServersResponse) => {
			displayResponse(commitMcpServersResponse(response));
			setServerActionErrors({});
		},
		[displayResponse],
	);

	const setServerActionError = useCallback(
		(
			serverName: string,
			message?: string,
			status: McpActionError["status"] = "action-failed",
			notify = true,
		) => {
			if (message && notify) {
				callbacks.current.onActionError?.(serverName);
			}
			setServerActionErrors((current) => {
				if (message) {
					return { ...current, [serverName]: { message, status } };
				}
				if (!(serverName in current)) {
					return current;
				}
				const next = { ...current };
				delete next[serverName];
				return next;
			});
		},
		[],
	);

	const refreshServers = useCallback(
		async (force = false) => {
			const response = await refresh(force);
			if (response) {
				displayResponse(response);
				setServerActionErrors({});
			}
		},
		[refresh, displayResponse],
	);
	const beginServerAction = (name: string) => {
		if (busyServers.current.has(name)) return false;
		busyServers.current = new Set(busyServers.current).add(name);
		setBusyServerNames(busyServers.current);
		setServerActionError(name);
		return true;
	};
	const finishServerAction = (name: string) => {
		busyServers.current = new Set(busyServers.current);
		busyServers.current.delete(name);
		setBusyServerNames(busyServers.current);
	};

	const toggleServer = async (server: McpServer, disabled: boolean) => {
		if (!beginServerAction(server.name)) return;
		try {
			const response = await desktopClient.invoke<McpServersResponse>(
				"set_mcp_server_disabled",
				{
					name: server.name,
					disabled,
				},
				HUB_QUEUED,
			);
			applyResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setServerActionError(server.name, message);
		} finally {
			finishServerAction(server.name);
		}
	};

	const upsertServer = async (input: McpServerUpsertInput) => {
		const name = input.previousName ?? input.name;
		if (!beginServerAction(name)) return;
		try {
			const response = await desktopClient.invoke<McpServersResponse>(
				"upsert_mcp_server",
				{
					input,
				},
				HUB_QUEUED,
			);
			callbacks.current.onServerSaved?.(input.name, input.previousName);
			applyResponse(response);
		} catch (error) {
			if (input.previousName !== undefined) {
				setServerActionError(
					input.previousName,
					error instanceof Error ? error.message : String(error),
					"action-failed",
					false,
				);
			}
			throw error;
		} finally {
			finishServerAction(name);
		}
	};

	const deleteServer = async (serverName: string) => {
		if (!beginServerAction(serverName)) return;
		try {
			const response = await desktopClient.invoke<McpServersResponse>(
				"delete_mcp_server",
				{
					name: serverName,
				},
				HUB_QUEUED,
			);
			applyResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setServerActionError(serverName, message, "delete-failed");
		} finally {
			finishServerAction(serverName);
		}
	};

	const authorizeOAuth = async (serverName: string) => {
		setAuthorizingServerName(serverName);
		setServerActionError(serverName);
		try {
			const response = await desktopClient.invoke<McpServersResponse>(
				"authorize_mcp_server_oauth",
				{ name: serverName },
				HUB_QUEUED,
			);
			applyResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await refreshServers(true);
			setServerActionError(serverName, message, "connection-error");
		} finally {
			setAuthorizingServerName(null);
		}
	};

	const cancelOAuth = async (serverName: string) => {
		setServerActionError(serverName);
		try {
			const response = await desktopClient.invoke<McpServersResponse>(
				"cancel_mcp_server_oauth",
				{ name: serverName },
			);
			applyResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setServerActionError(serverName, message, "connection-error");
		} finally {
			setAuthorizingServerName(null);
		}
	};

	return {
		servers,
		settingsPath: response?.settingsPath ?? "",
		hasSettingsFile: response?.hasSettingsFile ?? false,
		isLoading,
		errorMessage: inventoryError,
		serverActionErrors,
		busyServerNames,
		authorizingServerName,
		refreshServers,
		toggleServer,
		upsertServer,
		deleteServer,
		authorizeOAuth,
		cancelOAuth,
	};
}
