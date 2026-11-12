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
	const [openedSettingsPath, setOpenedSettingsPath] = useState<string | null>(
		null,
	);
	const settingsPath = openedSettingsPath ?? response?.settingsPath ?? "";
	const hasSettingsFile =
		openedSettingsPath !== null || (response?.hasSettingsFile ?? false);
	const lastDisplayedResponse = useRef<McpServersResponse | null>(null);
	const [isOpeningSettingsFile, setIsOpeningSettingsFile] = useState(false);
	const [actionError, setErrorMessage] = useState<string | null>(null);
	const errorMessage = actionError ?? inventoryError;
	const [serverActionErrors, setServerActionErrors] = useState<
		Record<string, McpActionError>
	>({});
	const [busyServerName, setBusyServerName] = useState<string | null>(null);
	const [authorizingServerName, setAuthorizingServerName] = useState<
		string | null
	>(null);
	const displayResponse = useCallback((response: McpServersResponse) => {
		lastDisplayedResponse.current = response;
		setOpenedSettingsPath(null);
		callbacks.current.onResponse?.(response);
		callbacks.current.onInventoryChanged?.();
	}, []);
	useEffect(() => {
		if (!response || response === lastDisplayedResponse.current) return;
		displayResponse(response);
		setServerActionErrors({});
		setErrorMessage(null);
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
			setErrorMessage(null);
			const response = await refresh(force);
			if (response) {
				displayResponse(response);
				setServerActionErrors({});
			}
		},
		[refresh, displayResponse],
	);

	const toggleServer = async (server: McpServer, disabled: boolean) => {
		setBusyServerName(server.name);
		setErrorMessage(null);
		setServerActionError(server.name);
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
			setBusyServerName(null);
		}
	};

	const upsertServer = async (input: McpServerUpsertInput) => {
		if (input.previousName !== undefined)
			setServerActionError(input.previousName);
		setBusyServerName(input.previousName ?? input.name);
		setErrorMessage(null);
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
			setBusyServerName(null);
		}
	};

	const deleteServer = async (serverName: string) => {
		setBusyServerName(serverName);
		setErrorMessage(null);
		setServerActionError(serverName);
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
			setBusyServerName(null);
		}
	};

	const authorizeOAuth = async (serverName: string) => {
		setAuthorizingServerName(serverName);
		setErrorMessage(null);
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
		setErrorMessage(null);
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

	const openSettingsFile = async () => {
		setIsOpeningSettingsFile(true);
		setErrorMessage(null);
		try {
			const openedPath = await desktopClient.invoke<string>(
				"open_mcp_settings_file",
				undefined,
				HUB_QUEUED,
			);
			if (openedPath.trim().length > 0) {
				setOpenedSettingsPath(openedPath);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setIsOpeningSettingsFile(false);
		}
	};

	return {
		servers,
		settingsPath,
		hasSettingsFile,
		isLoading,
		isOpeningSettingsFile,
		errorMessage,
		serverActionErrors,
		busyServerName,
		authorizingServerName,
		refreshServers,
		toggleServer,
		upsertServer,
		deleteServer,
		authorizeOAuth,
		cancelOAuth,
		openSettingsFile,
	};
}
