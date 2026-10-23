import { Plus } from "lucide-react-native";
import { useEffect } from "react";
import { ActionSheetIOS, Alert, Keyboard, Platform } from "react-native";
import { IconButton, useTheme } from "@/ui";
import { useTextFileAttachment } from "./TextFileAttachment";

export function ComposerAttachmentMenu({
	draft,
	onDraftChange,
	onPickImages,
	disabled = false,
	onError,
}: {
	draft: string;
	onDraftChange(text: string): void;
	onPickImages(): void;
	disabled?: boolean;
	onError?(message: string | undefined): void;
}) {
	const theme = useTheme();
	const file = useTextFileAttachment(draft, onDraftChange);
	useEffect(() => onError?.(file.error), [file.error, onError]);
	const open = () => {
		Keyboard.dismiss();
		onError?.(undefined);
		if (Platform.OS === "ios") {
			ActionSheetIOS.showActionSheetWithOptions(
				{
					options: ["Photo library", "Text file", "Cancel"],
					cancelButtonIndex: 2,
					userInterfaceStyle: theme.mode,
				},
				(index) => {
					if (index === 0) onPickImages();
					if (index === 1) void file.pick();
				},
			);
		} else {
			Alert.alert("Add to message", undefined, [
				{ text: "Photo library", onPress: onPickImages },
				{ text: "Text file", onPress: () => void file.pick() },
				{ text: "Cancel", style: "cancel" },
			]);
		}
	};
	return (
		<IconButton
			accessibilityLabel={file.busy ? "Reading text file" : "Add attachment"}
			disabled={disabled || file.busy}
			onPress={open}
			padding={0}
		>
			<Plus size={20} color={theme.color.textMuted} />
		</IconButton>
	);
}
