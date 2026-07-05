import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import open from "open";
import { useCallback } from "react";
import type { ClineAccountSnapshot } from "../cline-account";
import {
	type AccountDialogAction,
	AccountDialogContent,
} from "../components/dialogs/account-dialog";
import { OAuthLoginContent } from "../components/dialogs/provider-picker";
import type { OpenModelSelectorOptions } from "./use-model-selector";

export function useAccountDialog(opts: {
	dialog: DialogActions;
	termHeight: number;
	loadAccount: () => Promise<ClineAccountSnapshot>;
	switchAccount: (organizationId?: string | null) => Promise<void>;
	onAccountChange?: () => Promise<void>;
	openModelSelector: (options?: OpenModelSelectorOptions) => Promise<void>;
	refocusTextarea: () => void;
}) {
	const {
		dialog,
		termHeight,
		loadAccount,
		switchAccount,
		onAccountChange,
		openModelSelector,
		refocusTextarea,
	} = opts;

	const openAccountDialog = useCallback(async () => {
		const action = await dialog.choice<AccountDialogAction>({
			size: "large",
			style: { maxHeight: termHeight - 2 },
			closeOnEscape: false,
			content: (ctx: ChoiceContext<AccountDialogAction>) => (
				<AccountDialogContent
					{...ctx}
					loadAccount={loadAccount}
					switchAccount={switchAccount}
					onAccountChange={onAccountChange}
				/>
			),
		});
		if (action === "change-model") {
			await openModelSelector({ onCancel: openAccountDialog });
			return;
		}
		if (action === "change-provider") {
			await openModelSelector({
				onCancel: openAccountDialog,
				startWithProviderChange: true,
			});
			return;
		}
		if (action === "learn-more") {
			await open("https://cline.bot", { wait: false }).catch(() => {});
			refocusTextarea();
			return;
		}
		if (action === "login") {
			const saved = await dialog.choice<boolean>({
				style: { maxHeight: termHeight - 2 },
				closeOnEscape: false,
				content: (ctx: ChoiceContext<boolean>) => (
					<OAuthLoginContent {...ctx} providerId="cline" providerName="Cline" />
				),
			});
			if (saved) {
				await onAccountChange?.();
				await openAccountDialog();
				return;
			}
		}
		refocusTextarea();
	}, [
		dialog,
		loadAccount,
		onAccountChange,
		openModelSelector,
		refocusTextarea,
		switchAccount,
		termHeight,
	]);

	return openAccountDialog;
}
