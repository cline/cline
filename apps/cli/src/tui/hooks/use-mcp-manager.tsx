import {
	resolveDefaultMcpSettingsPath,
	setMcpServerDisabled,
} from "@cline/core";
import type {
	InteractiveConfigData,
	InteractiveConfigItem,
	McpEntry,
	McpServerToggleResult,
} from "@cline/ui/tui";
import { McpManagerContent } from "@cline/ui/tui";
import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";

function stringifyError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function toggleMcpServer(server: McpEntry): McpServerToggleResult {
	if (server.pluginName) {
		return {
			ok: false,
			message: `MCP server "${server.name}" is managed by plugin "${server.pluginName}". Disable the plugin to disable this server.`,
		};
	}
	try {
		const currentlyEnabled = server.enabled !== false;
		setMcpServerDisabled({
			filePath: server.path,
			name: server.name,
			disabled: currentlyEnabled,
		});
		return {
			ok: true,
			server: {
				...server,
				enabled: !currentlyEnabled,
			},
		};
	} catch (error) {
		return {
			ok: false,
			message: `Unable to toggle MCP server "${server.name}": ${stringifyError(error)}`,
		};
	}
}

function toMcpEntries(items: InteractiveConfigItem[]): McpEntry[] {
	return items.map((item) => ({
		name: item.name,
		path: item.path,
		enabled: item.enabled,
		description: item.description,
		lastError: item.loadError,
		pluginName: item.pluginName,
	}));
}

export function createMcpManagerOpener(opts: {
	dialog: DialogActions;
	termHeight: number;
	loadConfigData: () => Promise<InteractiveConfigData>;
	onSessionRestart: () => Promise<void>;
	refocusTextarea: () => void;
}) {
	return async (options?: { refocus?: boolean }): Promise<boolean> => {
		const data = await opts.loadConfigData().catch(() => undefined);
		const servers = toMcpEntries(data?.mcp ?? []);
		const changed = await opts.dialog.choice<boolean>({
			style: { maxHeight: opts.termHeight - 2 },
			closeOnEscape: false,
			content: (ctx: ChoiceContext<boolean>) => (
				<McpManagerContent
					{...ctx}
					servers={servers}
					defaultSettingsPath={resolveDefaultMcpSettingsPath()}
					onToggleServer={toggleMcpServer}
				/>
			),
		});
		if (changed) {
			await opts.onSessionRestart();
		}
		if (options?.refocus !== false) {
			opts.refocusTextarea();
		}
		return changed === true;
	};
}
