import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import { useCallback } from "react";
import type {
	InteractiveConfigData,
	InteractiveConfigItem,
} from "../../tui/interactive-config";
import {
	type McpEntry,
	McpManagerContent,
} from "../components/dialogs/mcp-manager-dialog";

function toMcpEntries(items: InteractiveConfigItem[]): McpEntry[] {
	return items.map((item) => ({
		name: item.name,
		enabled: item.enabled,
	}));
}

export function useMcpManager(opts: {
	dialog: DialogActions;
	termHeight: number;
	loadConfigData: () => Promise<InteractiveConfigData>;
	onSessionRestart: () => Promise<void>;
	refocusTextarea: () => void;
}) {
	return useCallback(
		async (options?: { refocus?: boolean }) => {
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
		},
		[opts],
	);
}
