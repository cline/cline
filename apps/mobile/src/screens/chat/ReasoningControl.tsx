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
	loading = supported === undefined,
	onPress,
}: ReasoningProps & { onPress(): void; loading?: boolean }) {
	const theme = useTheme();
	if (supported === undefined && !loading) {
		return (
			<View
				accessible
				accessibilityRole="text"
				accessibilityLabel="Thinking options unavailable. Choose another model to configure thinking."
				style={{
					flex: 1,
					minWidth: 0,
					flexDirection: "row",
					gap: 6,
					paddingVertical: 5,
				}}
			>
				<Brain size={14} color={theme.color.textMuted} />
				<View style={{ flex: 1, gap: 4 }}>
					<Text variant="caption" tone="muted">
						Thinking options unavailable
					</Text>
					<Text variant="caption" tone="muted">
						Choose another model to configure thinking.
					</Text>
				</View>
			</View>
		);
	}
	const label =
		supported === false
			? "Thinking unavailable"
			: supported === undefined
				? "Checking thinking…"
				: value === undefined
					? "Thinking level"
					: `Thinking: ${REASONING_CHOICES.find((choice) => choice.value === value)?.label.toLowerCase()}`;
	const level =
		REASONING_CHOICES.find((choice) => choice.value === value)?.label ??
		"Model setting";
	return (
		<ComposerPill
			label={label}
			leading={<Brain size={14} color={theme.color.textMuted} />}
			accessibilityLabel={
				supported === true ? `Thinking level: ${level}` : label
			}
			accessibilityHint={
				supported === true
					? value === "none"
						? "Extra thinking is off for your next message. Tap to change."
						: value === undefined
							? "The current level was not reported. Choose a thinking level for your next message."
							: "Choose how much extra thinking to request for your next message."
					: supported === false
						? "This model does not offer a configurable thinking level."
						: "Thinking controls become available when the model's capabilities are confirmed."
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
					Thinking gives the model more time to work through a request. Higher
					levels can take longer and use more tokens. Your choice applies to
					your next message.
				</Text>
				{value === undefined && supported === true ? (
					<Text variant="small" tone="muted">
						The current level is not reported by this session. Choose a level to
						override it.
					</Text>
				) : null}
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
						<View style={{ flex: 1, gap: 2 }}>
							<Text>{choice.label}</Text>
							{choice.value === "none" ? (
								<Text variant="caption" tone="muted">
									Do not request extra thinking.
								</Text>
							) : null}
						</View>
						{value === choice.value ? (
							<Check size={16} color={theme.brand.violet} />
						) : null}
					</Pressable>
				))}
			</View>
		</BottomSheet>
	);
}
