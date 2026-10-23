import type GorhomBottomSheet from "@gorhom/bottom-sheet";
import { Brain, Check } from "lucide-react-native";
import type { RefObject } from "react";
import { Pressable, View } from "react-native";
import { REASONING_CHOICES, type ReasoningChoice } from "@/session/reasoning";
import { BottomSheet, Text, useTheme } from "@/ui";
import { ComposerPill } from "./ComposerPill";

interface ReasoningProps {
	value?: ReasoningChoice;
	supported?: boolean;
}
export function ReasoningPill({
	value,
	supported,
	onPress,
}: ReasoningProps & { onPress(): void }) {
	const theme = useTheme();
	const label =
		supported === false
			? "None"
			: (REASONING_CHOICES.find((choice) => choice.value === value)?.label ??
				"Reasoning");
	return (
		<ComposerPill
			label={label}
			leading={<Brain size={14} color={theme.color.textMuted} />}
			accessibilityLabel={`Thinking level: ${label}`}
			accessibilityHint={
				supported === true
					? "Applies to your next message"
					: "Reasoning support is unavailable for this model"
			}
			onPress={supported === true ? onPress : undefined}
		/>
	);
}
export function ReasoningSheet({
	value,
	supported,
	onChange,
	sheetRef,
}: ReasoningProps & {
	onChange(choice: ReasoningChoice): void;
	sheetRef: RefObject<GorhomBottomSheet | null>;
}) {
	const theme = useTheme();
	return (
		<BottomSheet
			ref={sheetRef}
			index={-1}
			enableDynamicSizing
			enablePanDownToClose
			scrollable
		>
			<View style={{ gap: 8 }}>
				<Text weight="500">Thinking level</Text>
				<Text variant="small" tone="muted">
					Applies to your next message, not the response already running.
				</Text>
				{REASONING_CHOICES.map((choice) => (
					<Pressable
						key={choice.value}
						accessibilityRole="radio"
						accessibilityLabel={`Thinking level: ${choice.label}`}
						accessibilityState={{
							checked: value === choice.value,
							disabled: supported !== true,
						}}
						disabled={supported !== true}
						onPress={() => {
							onChange(choice.value);
							sheetRef.current?.close();
						}}
						style={{
							minHeight: 44,
							padding: 10,
							flexDirection: "row",
							justifyContent: "space-between",
						}}
					>
						<Text>{choice.label}</Text>
						{value === choice.value ? (
							<Check size={16} color={theme.brand.violet} />
						) : null}
					</Pressable>
				))}
			</View>
		</BottomSheet>
	);
}
