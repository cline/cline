import type {
	InteractiveConfigData,
	InteractiveConfigItem,
} from "@cline/ui/tui";
import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import {
	type McpEntry,
	McpManagerContent,
} from "../dialogs/mcp-manager-dialog";

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
				<McpManagerContent {...ctx} servers={servers} />
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
