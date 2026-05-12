import { Llms } from "@cline/core";
import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import { useCallback, useMemo } from "react";
import type {
	InteractiveConfigData,
	InteractiveConfigItem,
} from "../../tui/interactive-config";
import type { CliCompactionMode, Config } from "../../utils/types";
import { ExtDetailContent } from "../components/dialogs/config-dialogs";
import { ConfigPanelContent } from "../views/config-view";
import type { ConfigAction } from "../views/config-view-helpers";
import type { OpenModelSelectorOptions } from "./use-model-selector";

export function useConfigPanel(opts: {
	dialog: DialogActions;
	config: Config;
	sessionUiMode: string;
	compactionMode: CliCompactionMode;
	toggleMode: () => void;
	toggleAutoApprove: () => void;
	setCompactionMode: (mode: CliCompactionMode) => void;
	termHeight: number;
	loadConfigData: () => Promise<InteractiveConfigData>;
	onToggleConfigItem?: (
		item: InteractiveConfigItem,
	) => Promise<InteractiveConfigData | undefined>;
	openModelSelector: (options?: OpenModelSelectorOptions) => Promise<void>;
	openMcpManager: (options?: { refocus?: boolean }) => Promise<boolean>;
	refocusTextarea: () => void;
}) {
	const emptyConfigData = useMemo(
		() => ({
			workflows: [] as InteractiveConfigItem[],
			rules: [] as InteractiveConfigItem[],
			skills: [] as InteractiveConfigItem[],
			hooks: [] as InteractiveConfigItem[],
			agents: [] as InteractiveConfigItem[],
			plugins: [] as InteractiveConfigItem[],
			mcp: [] as InteractiveConfigItem[],
			tools: [] as InteractiveConfigItem[],
		}),
		[],
	);

	const openConfig = useCallback(async () => {
		let keepOpen = true;
		while (keepOpen) {
			const [data, providerInfo] = await Promise.all([
				opts.loadConfigData().catch(() => emptyConfigData),
				Llms.getProvider(opts.config.providerId).catch(() => undefined),
			]);
			const providerDisplayName = providerInfo?.name ?? opts.config.providerId;
			const action = await opts.dialog.choice<ConfigAction>({
				size: "large",
				style: { maxHeight: opts.termHeight - 2 },
				closeOnEscape: false,
				content: (ctx: ChoiceContext<ConfigAction>) => (
					<ConfigPanelContent
						{...ctx}
						config={opts.config}
						configData={data}
						providerDisplayName={providerDisplayName}
						currentMode={opts.sessionUiMode}
						currentCompactionMode={opts.compactionMode}
						onToggleConfigItem={opts.onToggleConfigItem}
						onToggleMode={opts.toggleMode}
						onToggleAutoApprove={opts.toggleAutoApprove}
						onSetCompactionMode={opts.setCompactionMode}
					/>
				),
			});

			if (!action) {
				keepOpen = false;
				continue;
			}

			if (action.kind === "open-provider") {
				await opts.openModelSelector({
					startWithProviderChange: true,
					onCancel: () => {},
				});
			} else if (action.kind === "open-model") {
				await opts.openModelSelector({ onCancel: () => {} });
			} else if (action.kind === "toggle-item") {
				await opts.onToggleConfigItem?.(action.item);
			} else if (action.kind === "ext-detail") {
				await opts.dialog.choice<void>({
					style: { maxHeight: opts.termHeight - 2 },
					closeOnEscape: false,
					content: (ctx: ChoiceContext<void>) => (
						<ExtDetailContent
							{...ctx}
							item={action.item}
							onToggleConfigItem={opts.onToggleConfigItem}
						/>
					),
				});
			} else if (action.kind === "open-mcp") {
				const changed = await opts.openMcpManager({ refocus: false });
				if (changed) {
					keepOpen = false;
				}
			}
		}
		opts.refocusTextarea();
	}, [opts, emptyConfigData]);

	return openConfig;
}
