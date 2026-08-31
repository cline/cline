// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useState } from "react";
import { useDialogPalette } from "../../hooks/use-theme";
import { getMcpManagerEntryStatus } from "../../views/config-view-helpers";
import { DialogOptionRow } from "./option-row";

export interface McpEntry {
	name: string;
	path: string;
	enabled?: boolean;
	description?: string;
	lastError?: string;
	pluginName?: string;
}

export type McpServerToggleResult =
	| { ok: true; server: McpEntry }
	| { ok: false; message: string };

export function getMcpManagerFooterText(hasServers: boolean): string {
	return hasServers
		? "Space toggle selected, Esc to go back"
		: "Esc to go back";
}

export function McpManagerContent(
	props: ChoiceContext<boolean> & {
		servers: McpEntry[];
		/** Shown when no loaded server carries a settings path. */
		defaultSettingsPath: string;
		/** Host-side persistence for enabling/disabling a server. */
		onToggleServer: (server: McpEntry) => McpServerToggleResult;
	},
) {
	const palette = useDialogPalette();
	const [selected, setSelected] = useState(0);
	const [servers, setServers] = useState(props.servers);
	const [changed, setChanged] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const settingsPath = servers[0]?.path ?? props.defaultSettingsPath;
	const itemCount = servers.length;
	const selectedServer = servers[selected];
	const hasPluginOwnedServers = servers.some((server) => server.pluginName);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			if (changed) {
				props.resolve(true);
			} else {
				props.dismiss();
			}
			return;
		}
		if (itemCount > 0) {
			if (key.name === "up") {
				setError(null);
				setSelected((s) => (s > 0 ? s - 1 : itemCount - 1));
				return;
			}
			if (key.name === "down") {
				setError(null);
				setSelected((s) => (s < itemCount - 1 ? s + 1 : 0));
				return;
			}
			if (key.name === "space") {
				const target = servers[selected];
				const result = target ? props.onToggleServer(target) : undefined;
				if (result?.ok) {
					setServers((current) =>
						current.map((server, index) =>
							index === selected ? result.server : server,
						),
					);
					setChanged(true);
					setError(null);
				} else if (result) {
					setError(result.message);
				}
				return;
			}
		}
	}, props.dialogId);

	return (
		<box flexDirection="column" paddingX={1}>
			<text fg={palette.act}>MCP Servers</text>

			<text fg="gray" marginTop={1}>
				Settings file:
			</text>
			<text selectable>{settingsPath}</text>

			<text fg="gray" marginTop={1}>
				Run cline mcp to add, edit, or remove servers.
			</text>

			{servers.length > 0 && (
				<box flexDirection="column" marginTop={1}>
					{servers.map((srv, i) => {
						const enabled =
							typeof srv.enabled === "boolean" ? srv.enabled : true;
						const enabledIcon =
							typeof srv.enabled === "boolean" ? (enabled ? "● " : "○ ") : "";
						const status = getMcpManagerEntryStatus(srv);
						let labelColor = "gray";
						if (enabled && typeof srv.enabled === "boolean") {
							labelColor = palette.success;
						}
						if (srv.lastError) {
							labelColor = palette.error;
						}
						return (
							<DialogOptionRow
								key={srv.name}
								selected={i === selected}
								showMarker={false}
								label={`${enabledIcon}${srv.name}${srv.pluginName ? " *" : ""}`}
								description={status || undefined}
								labelColor={labelColor}
								descriptionColor={srv.lastError ? palette.error : "gray"}
							/>
						);
					})}
				</box>
			)}

			{servers.length === 0 && (
				<text fg="gray" marginTop={1}>
					No servers configured.
				</text>
			)}

			{error && (
				<text fg={palette.error} marginTop={1}>
					{error}
				</text>
			)}

			{selectedServer?.lastError && (
				<box flexDirection="column" marginTop={1}>
					<text fg={palette.error}>OAuth error</text>
					<text fg={palette.error}>{selectedServer.lastError}</text>
					<text fg="gray">
						Run cline mcp and choose Authorize OAuth to retry.
					</text>
				</box>
			)}

			{hasPluginOwnedServers && (
				<text fg="gray" marginTop={1}>
					* managed by plugin; disable the plugin to disable the server.
				</text>
			)}

			<text fg="gray" marginTop={1}>
				<em>{getMcpManagerFooterText(servers.length > 0)}</em>
			</text>
		</box>
	);
}
