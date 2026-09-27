// @jsxImportSource @opentui/react
import { basename } from "node:path";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useRef, useState } from "react";
import { useDialogPalette } from "../../hooks/use-theme";
import {
	formatDisplayPath,
	ONBOARDING_OPTIONS,
	resolveInheritanceKeyAction,
	resolveOnboardingKeyAction,
	type WorkspaceInheritanceChoice,
	type WorkspaceOnboardingChoice,
} from "./workspace-onboarding-helpers";

export type { WorkspaceInheritanceChoice, WorkspaceOnboardingChoice };
export { formatDisplayPath, ONBOARDING_OPTIONS };

export function WorkspaceOnboardingDialogContent(
	props: ChoiceContext<WorkspaceOnboardingChoice> & {
		cwd: string;
	},
) {
	const { resolve, dialogId } = props;
	const palette = useDialogPalette();
	const [selected, setSelected] = useState(0);
	const selectedRef = useRef(0);

	useDialogKeyboard((key) => {
		const action = resolveOnboardingKeyAction(key, selectedRef.current);
		if (action.action === "resolve") {
			resolve(action.value);
		} else if (action.action === "navigate") {
			selectedRef.current = action.selected;
			setSelected(action.selected);
		}
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text>Welcome to Cline</text>
			<text fg="gray">No Cline workspace detected in this project.</text>
			<text>? How would you like to configure this project?</text>

			<box flexDirection="column">
				{ONBOARDING_OPTIONS.map((opt, i) => {
					const isSel = i === selected;
					return (
						// biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI boxes handle terminal mouse input.
						<box
							key={opt.value}
							paddingX={1}
							flexDirection="row"
							backgroundColor={isSel ? palette.selection : undefined}
							onMouseDown={() => resolve(opt.value)}
						>
							<text
								fg={isSel ? palette.textOnSelection : "gray"}
								flexShrink={0}
							>
								{isSel ? "❯ " : "  "}
							</text>
							<text fg={isSel ? palette.textOnSelection : undefined}>
								{opt.label}
							</text>
						</box>
					);
				})}
			</box>

			<text fg="gray">
				<em>{"1/2 or ↑/↓ to choose, Enter to select, Esc for scratch"}</em>
			</text>
		</box>
	);
}

export function WorkspaceInheritanceDialogContent(
	props: ChoiceContext<WorkspaceInheritanceChoice> & {
		parentWorkspacePath: string;
		activeLayers: string[];
		cwd: string;
	},
) {
	const { resolve, dialogId, parentWorkspacePath, activeLayers, cwd } = props;
	const folderName = basename(cwd);
	const displayParent = formatDisplayPath(parentWorkspacePath);
	const layerNames =
		activeLayers.length > 0
			? activeLayers.join(", ")
			: basename(parentWorkspacePath);

	useDialogKeyboard((key) => {
		const action = resolveInheritanceKeyAction(key);
		if (action.action === "resolve") {
			resolve(action.value);
		}
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text>Cline Workspace</text>
			<text>ℹ Inherited parent workspace: {displayParent}</text>
			<text fg="gray"> Active layers: [{layerNames}]</text>

			<box flexDirection="column" marginTop={1}>
				<text> [Enter] Continue with parent workspace</text>
				<text fg="cyan">
					{" "}
					[c] Create local sub-cline (.cline/) in {folderName}
				</text>
			</box>

			<text fg="gray">
				<em>
					{"Enter to continue, c to create local sub-cline, Esc to dismiss"}
				</em>
			</text>
		</box>
	);
}
