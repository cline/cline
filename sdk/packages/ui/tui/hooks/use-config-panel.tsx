import { getProvider } from "@cline/llms";
import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import { useCallback, useMemo } from "react";
import {
	ConfigErrorContent,
	DeleteConfigItemConfirmContent,
	ExtDetailContent,
} from "../components/dialogs/config-dialogs";
import { withLoadingDialog } from "../components/dialogs/loading-dialog";
import type {
	InteractiveConfigData,
	InteractiveConfigItem,
	InteractiveConfigTab,
	LoadInteractiveConfigDataOptions,
} from "../config-model";
import type { CliCompactionMode } from "../formatting/compaction-mode";
import type {
	InteractiveTerminalUiConfig,
	OpenModelSelectorOptions,
} from "../types";
import { ConfigPanelContent } from "../views/config-view";
import type { ConfigAction } from "../views/config-view-helpers";

export interface OpenConfigOptions {
	initialTab?: InteractiveConfigTab;
}

export function useConfigPanel(opts: {
	dialog: DialogActions;
	config: InteractiveTerminalUiConfig;
	sessionUiMode: string;
	compactionMode: CliCompactionMode;
	toggleMode: () => void;
	toggleAutoApprove: () => void;
	setCompactionMode: (mode: CliCompactionMode) => void;
	termHeight: number;
	loadConfigData: (
		options?: LoadInteractiveConfigDataOptions,
	) => Promise<InteractiveConfigData>;
	onToggleConfigItem?: (
		item: InteractiveConfigItem,
		options?: LoadInteractiveConfigDataOptions,
	) => Promise<InteractiveConfigData | undefined>;
	onDeleteConfigItem?: (
		item: InteractiveConfigItem,
		options?: LoadInteractiveConfigDataOptions,
	) => Promise<InteractiveConfigData | undefined>;
	openModelSelector: (options?: OpenModelSelectorOptions) => Promise<void>;
	openMcpManager: (options?: { refocus?: boolean }) => Promise<boolean>;
	openThemePicker: (options?: { refocus?: boolean }) => Promise<void>;
	autoUpdateSetting?: {
		load(): boolean;
		save(enabled: boolean): void;
	};
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
			workflowSlashCommands: [],
		}),
		[],
	);

	const openConfig = useCallback(
		async (options: OpenConfigOptions = {}) => {
			let keepOpen = true;
			let activeTab = options.initialTab;
			while (keepOpen) {
				const [data, providerInfo] = await withLoadingDialog(
					opts.dialog,
					"Loading settings...",
					async () =>
						await Promise.all([
							opts
								.loadConfigData({ includePluginTools: false })
								.catch(() => emptyConfigData),
							getProvider(opts.config.providerId).catch(() => undefined),
						]),
				);
				const providerDisplayName =
					providerInfo?.name ?? opts.config.providerId;
				const action = await opts.dialog.choice<ConfigAction>({
					size: "large",
					style: { maxHeight: opts.termHeight - 2 },
					closeOnEscape: false,
					content: (ctx: ChoiceContext<ConfigAction>) => (
						<ConfigPanelContent
							{...ctx}
							config={opts.config}
							configData={data}
							loadConfigData={opts.loadConfigData}
							providerDisplayName={providerDisplayName}
							currentMode={opts.sessionUiMode}
							currentCompactionMode={opts.compactionMode}
							initialTab={activeTab}
							onActiveTabChange={(tab) => {
								activeTab = tab;
							}}
							onToggleConfigItem={opts.onToggleConfigItem}
							onDeleteConfigItem={opts.onDeleteConfigItem}
							onToggleMode={opts.toggleMode}
							onToggleAutoApprove={opts.toggleAutoApprove}
							onSetCompactionMode={opts.setCompactionMode}
							autoUpdateSetting={opts.autoUpdateSetting}
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
				} else if (action.kind === "open-theme") {
					await opts.openThemePicker({ refocus: false });
				} else if (action.kind === "toggle-item") {
					await opts.onToggleConfigItem?.(action.item);
				} else if (action.kind === "delete-item") {
					const confirmed = await opts.dialog.choice<boolean>({
						closeOnEscape: true,
						content: (ctx: ChoiceContext<boolean>) => (
							<DeleteConfigItemConfirmContent {...ctx} item={action.item} />
						),
					});
					if (confirmed && opts.onDeleteConfigItem) {
						try {
							await withLoadingDialog(
								opts.dialog,
								`Deleting ${action.item.name}...`,
								async () =>
									await opts.onDeleteConfigItem?.(action.item, {
										includePluginTools: false,
									}),
							);
						} catch (error) {
							await opts.dialog.choice<void>({
								closeOnEscape: true,
								content: (ctx: ChoiceContext<void>) => (
									<ConfigErrorContent
										{...ctx}
										title="Plugin delete failed"
										message={
											error instanceof Error ? error.message : String(error)
										}
									/>
								),
							});
						}
					}
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
		},
		[opts, emptyConfigData],
	);

	return openConfig;
}
