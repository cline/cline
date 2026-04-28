import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDefaultMcpSettingsPath } from "@clinebot/core";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useState } from "react";

export interface McpEntry {
	name: string;
	enabled?: boolean;
}

function removeMcpServer(name: string): boolean {
	const settingsPath = resolveDefaultMcpSettingsPath();
	if (!existsSync(settingsPath)) return false;
	try {
		const raw = readFileSync(settingsPath, "utf-8");
		const parsed = JSON.parse(raw) as {
			mcpServers?: Record<string, unknown>;
		};
		const servers = parsed.mcpServers ?? {};
		if (!(name in servers)) return false;
		delete servers[name];
		mkdirSync(dirname(settingsPath), { recursive: true });
		writeFileSync(
			settingsPath,
			`${JSON.stringify({ mcpServers: servers }, null, 2)}\n`,
		);
		return true;
	} catch {
		return false;
	}
}

export function McpManagerContent(
	props: ChoiceContext<boolean> & {
		servers: McpEntry[];
	},
) {
	const [selected, setSelected] = useState(0);
	const [servers, setServers] = useState(props.servers);
	const [deleted, setDeleted] = useState(false);

	const settingsPath = resolveDefaultMcpSettingsPath();
	const itemCount = servers.length;

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			if (deleted) {
				props.resolve(true);
			} else {
				props.dismiss();
			}
			return;
		}
		if (itemCount > 0) {
			if (key.name === "up") {
				setSelected((s) => (s > 0 ? s - 1 : itemCount - 1));
				return;
			}
			if (key.name === "down") {
				setSelected((s) => (s < itemCount - 1 ? s + 1 : 0));
				return;
			}
			if (key.name === "d" || key.name === "backspace") {
				const target = servers[selected];
				if (target && removeMcpServer(target.name)) {
					const next = servers.filter((_, i) => i !== selected);
					setServers(next);
					setDeleted(true);
					if (selected >= next.length && next.length > 0) {
						setSelected(next.length - 1);
					}
				}
				return;
			}
		}
	}, props.dialogId);

	return (
		<box flexDirection="column" paddingX={1}>
			<text fg="cyan">MCP Servers</text>

			<text fg="gray" marginTop={1}>
				Settings file:
			</text>
			<text selectable>{settingsPath}</text>

			<text fg="gray" marginTop={1}>
				Run clite mcp to add, edit, or remove servers.
			</text>

			{servers.length > 0 && (
				<box flexDirection="column" marginTop={1}>
					{servers.map((srv, i) => {
						const isSel = i === selected;
						return (
							<box
								key={srv.name}
								flexDirection="row"
								justifyContent="space-between"
							>
								<text fg={isSel ? "cyan" : "gray"}>
									{isSel ? "\u25b8 " : "  "}
									{srv.name}
								</text>
								{typeof srv.enabled === "boolean" && !srv.enabled && (
									<text fg="red">disabled</text>
								)}
							</box>
						);
					})}
				</box>
			)}

			{servers.length === 0 && (
				<text fg="gray" marginTop={1}>
					No servers configured.
				</text>
			)}

			<text fg="gray" marginTop={1}>
				<em>
					{servers.length > 0
						? "D to delete selected, Esc to go back"
						: "Esc to go back"}
				</em>
			</text>
		</box>
	);
}
