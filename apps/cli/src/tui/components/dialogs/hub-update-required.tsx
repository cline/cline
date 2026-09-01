// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useDialogPalette } from "../../hooks/use-theme";
import {
	describeOutdatedHubSessions,
	resolveHubUpdateRequiredKeyAction,
} from "./hub-update-required-helpers";

export interface HubUpdateRequiredDetails {
	hubCoreVersion?: string;
}

/**
 * Shown only for `unsupported_protocol`: the running Hub speaks a protocol
 * this CLI cannot, so nothing hub-backed works until the CLI updates. The
 * softer `build_mismatch` case (newer Hub, compatible protocol) is a toast
 * in root.tsx, not this modal.
 */
export function HubUpdateRequiredContent(
	props: ChoiceContext<boolean> & HubUpdateRequiredDetails,
) {
	const { dialogId, dismiss, hubCoreVersion, resolve } = props;
	const palette = useDialogPalette();

	useDialogKeyboard((key) => {
		const action = resolveHubUpdateRequiredKeyAction(key);
		if (action === "ignore") return;
		if (action === "update") {
			resolve(true);
			return;
		}
		dismiss();
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg="yellow">Cline Hub was updated</text>
			<box flexDirection="column">
				<text selectable>
					Another Cline installation updated the shared Cline Hub
					{hubCoreVersion ? ` (core ${hubCoreVersion})` : ""} to a version this
					CLI cannot talk to.
				</text>
				<text selectable>
					Update and restart Cline to reconnect to the running Hub.
				</text>
			</box>
			<box flexDirection="row">
				<box paddingX={1} backgroundColor={palette.act}>
					<text fg={palette.textOnSelection}>Update and restart</text>
				</box>
			</box>
			<text fg={palette.muted}>
				Press Enter to update and restart, Esc to dismiss
			</text>
		</box>
	);
}

export interface HubOutdatedDetails {
	hubCoreVersion?: string;
	activeSessionCount?: number;
	participantClientCount?: number;
}

/**
 * Shown when this CLI is the newer build and the shared Hub was left running
 * an older one because it is still serving other clients' sessions. Enter
 * replaces the Hub now (interrupting that work); Esc keeps it running.
 */
export function HubOutdatedContent(
	props: ChoiceContext<boolean> & HubOutdatedDetails,
) {
	const {
		activeSessionCount,
		dialogId,
		dismiss,
		participantClientCount,
		resolve,
	} = props;
	const palette = useDialogPalette();

	useDialogKeyboard((key) => {
		const action = resolveHubUpdateRequiredKeyAction(key);
		if (action === "ignore") return;
		if (action === "update") {
			resolve(true);
			return;
		}
		dismiss();
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg="yellow">Cline Hub update required</text>
			<box flexDirection="column">
				<text selectable>
					This CLI needs a newer Cline Hub, but the running one is still serving{" "}
					{describeOutdatedHubSessions({
						activeSessionCount,
						participantClientCount,
					})}
					.
				</text>
				<text selectable>
					Updating stops that Hub and interrupts its sessions.
				</text>
			</box>
			<box flexDirection="row">
				<box paddingX={1} backgroundColor={palette.act}>
					<text fg={palette.textOnSelection}>Update Now</text>
				</box>
			</box>
			<text fg={palette.muted}>
				Press Enter to update now, Esc to keep the Hub running
			</text>
		</box>
	);
}
