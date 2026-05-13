import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useState } from "react";
import type {
	InteractiveConfigData,
	InteractiveConfigItem,
} from "../../interactive-config";
import { palette } from "../../palette";
import {
	getExtDetailFooterText,
	getExtDetailRows,
	shouldCloseExtDetailForKey,
	shouldToggleExtDetailForKey,
} from "./config-dialogs-helpers";

export function ExtDetailContent(
	props: ChoiceContext<void> & {
		item: InteractiveConfigItem;
		onToggleConfigItem?: (
			item: InteractiveConfigItem,
		) => Promise<InteractiveConfigData | undefined>;
	},
) {
	const [item, setItem] = useState(props.item);
	const [toggleError, setToggleError] = useState<string | undefined>();

	const toggleStatus = async () => {
		if (
			!props.onToggleConfigItem ||
			!shouldToggleExtDetailForKey("space", item)
		) {
			return;
		}
		setToggleError(undefined);
		try {
			const nextData = await props.onToggleConfigItem(item);
			const nextItem = [
				...(nextData?.workflows ?? []),
				...(nextData?.rules ?? []),
				...(nextData?.skills ?? []),
				...(nextData?.hooks ?? []),
				...(nextData?.agents ?? []),
				...(nextData?.plugins ?? []),
				...(nextData?.mcp ?? []),
				...(nextData?.tools ?? []),
			].find(
				(candidate) => candidate.id === item.id && candidate.path === item.path,
			);
			setItem(nextItem ?? { ...item, enabled: !item.enabled });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setToggleError(`Failed to update ${item.name}: ${message}`);
		}
	};

	useDialogKeyboard((key) => {
		if (shouldToggleExtDetailForKey(key.name, item)) {
			void toggleStatus();
			return;
		}
		if (shouldCloseExtDetailForKey(key.name)) {
			props.dismiss();
		}
	}, props.dialogId);
	const rows = getExtDetailRows(item);
	const footerText = getExtDetailFooterText(item);

	return (
		<box flexDirection="column" paddingX={1}>
			{rows.map((row) => {
				switch (row.kind) {
					case "header":
						return (
							<box
								key="header"
								flexDirection="row"
								justifyContent="space-between"
							>
								<text fg="cyan">
									<strong>{row.name}</strong>
								</text>
								<text
									fg={row.source === "workspace" ? palette.success : "gray"}
								>
									{row.source}
								</text>
							</box>
						);
					case "field":
						return (
							<box key={row.label} flexDirection="column" marginTop={1}>
								<text fg="gray">{row.label}</text>
								{row.value.map((line) => (
									<text key={`${row.label}-${line}`}>{line || " "}</text>
								))}
							</box>
						);
					case "status":
						return (
							<box
								key="status"
								flexDirection="row"
								marginTop={1}
								justifyContent="space-between"
							>
								<text fg="gray">Status</text>
								<text fg={row.enabled ? palette.success : "red"}>
									{row.enabled ? "Enabled" : "Disabled"}
								</text>
							</box>
						);
				}
				return null;
			})}
			<text fg="gray" marginTop={1}>
				<em>{footerText}</em>
			</text>
			{toggleError && (
				<text fg="red" marginTop={1}>
					{toggleError}
				</text>
			)}
		</box>
	);
}
