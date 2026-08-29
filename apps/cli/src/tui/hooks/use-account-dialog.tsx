import type { OpenModelSelectorOptions } from "@cline/ui/tui";
import { type AccountDialogAction, AccountDialogContent } from "@cline/ui/tui";
import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import open from "../../utils/open";
import type { ClineAccountSnapshot } from "../cline-account";
import {
	OAuthLoginContent,
	type OAuthLoginResult,
} from "../dialogs/provider-picker";

export function createAccountDialogOpener(opts: {
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

	const openAccountDialog = async (): Promise<void> => {
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
			const saved = await dialog.choice<OAuthLoginResult>({
				style: { maxHeight: termHeight - 2 },
				closeOnEscape: false,
				content: (ctx: ChoiceContext<OAuthLoginResult>) => (
					<OAuthLoginContent {...ctx} providerId="cline" providerName="Cline" />
				),
			});
			if (saved === true) {
				await onAccountChange?.();
				await openAccountDialog();
				return;
			}
		}
		refocusTextarea();
	};

	return openAccountDialog;
}
