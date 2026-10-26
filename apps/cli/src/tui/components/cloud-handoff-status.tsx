import { useKeyboard } from "@opentui/react";
import type { CloudHandoffDraft } from "../../runtime/interactive/cloud-handoff";
import open from "../../utils/open";
import type { CloudHandoffStatus } from "../hooks/use-cloud-handoff";

export function CloudHandoffStatusBar(props: {
	status: CloudHandoffStatus;
	disabled: boolean;
	onDismiss: () => void;
	onRetry: () => Promise<void>;
	onRestore: (draft: CloudHandoffDraft) => void;
}) {
	const { status } = props;
	const url =
		status.kind === "complete"
			? status.result.dashboardUrl
			: status.kind === "progress"
				? status.progress.dashboardUrl
				: undefined;
	const message =
		status.kind === "progress"
			? status.progress.message
			: status.kind === "failed"
				? status.message
				: (status.result.warning ??
					"Cloud task ready. You can keep working locally.");
	const openCloud = () => {
		if (url) void open(url, { wait: false }).catch(() => {});
	};
	useKeyboard((key) => {
		if (props.disabled || !key.meta) return;
		if (key.name === "o" && url) {
			key.preventDefault();
			openCloud();
		} else if (key.name === "r" && status.kind === "failed") {
			key.preventDefault();
			props.onRestore(status.draft);
		} else if (
			key.name === "r" &&
			status.kind === "complete" &&
			status.result.retrySend
		) {
			key.preventDefault();
			void props.onRetry();
		} else if (key.name === "d" && status.kind !== "progress") {
			key.preventDefault();
			props.onDismiss();
		}
	});
	return (
		<box flexDirection="column" paddingX={1} flexShrink={0}>
			<text fg={status.kind === "failed" ? "red" : "cyan"}>
				Cloud handoff: {message}
			</text>
			{url && (
				<box onMouseDown={openCloud}>
					<text>
						<a href={url}>Open cloud task (Alt+O): {url}</a>
					</text>
				</box>
			)}
			{status.kind !== "progress" && (
				<box flexDirection="row" gap={2}>
					{status.kind === "failed" && (
						<box onMouseDown={() => props.onRestore(status.draft)}>
							<text>Restore /cloud draft (Alt+R)</text>
						</box>
					)}
					{status.kind === "complete" && status.result.retrySend && (
						<box
							onMouseDown={() => {
								void props.onRetry();
							}}
						>
							<text>Retry saved prompt (Alt+R)</text>
						</box>
					)}
					<box onMouseDown={props.onDismiss}>
						<text fg="gray">Dismiss (Alt+D)</text>
					</box>
				</box>
			)}
		</box>
	);
}
