import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { type ReactNode, useRef, useState } from "react";
import {
	type StyleProp,
	TextInput,
	type TextInputProps,
	useWindowDimensions,
	View,
	type ViewStyle,
} from "react-native";
import { fontFamily, useTheme } from "../theme";

export type TextFieldVariant = "outlined" | "search";

type FocusHandler = NonNullable<TextInputProps["onFocus"]>;

export interface TextFieldProps extends Omit<TextInputProps, "style"> {
	variant?: TextFieldVariant;
	/** Register focus with the enclosing Gorhom sheet for keyboard avoidance. */
	inBottomSheet?: boolean;
	/** Leading element (e.g. a Search icon). */
	leading?: ReactNode;
	/** Trailing element (e.g. a clear button). */
	trailing?: ReactNode;
	containerStyle?: StyleProp<ViewStyle>;
	inputStyle?: TextInputProps["style"];
}

/**
 * Single-line input with an optional leading/trailing slot. `outlined` sits on
 * `canvas` with a border that turns violet on focus (composer/field treatment);
 * `search` is the borderless `surfaceMuted` sidebar search shell.
 */
export function TextField({
	variant = "outlined",
	inBottomSheet = false,
	leading,
	trailing,
	containerStyle,
	inputStyle,
	onFocus,
	onBlur,
	defaultValue,
	onChangeText,
	...rest
}: TextFieldProps) {
	const theme = useTheme();
	const { fontScale } = useWindowDimensions();
	const [focused, setFocused] = useState(false);
	// The native host must remeasure Dynamic Type, but uncontrolled callers
	// still own their typed text rather than reverting to the original default.
	const nativeDraft = useRef(defaultValue);
	const Input = inBottomSheet ? BottomSheetTextInput : TextInput;

	const isSearch = variant === "search";
	// Desktop: `border-input` at rest (white @16%, a step stronger than the plain
	// hairline) → `focus:border-primary/50 focus:ring-1 focus:ring-primary/20`.
	const borderColor = focused
		? theme.brand.violetBorder
		: theme.color.borderStrong;

	const handleFocus: FocusHandler = (e) => {
		setFocused(true);
		onFocus?.(e);
	};
	const handleBlur: FocusHandler = (e) => {
		setFocused(false);
		onBlur?.(e);
	};

	return (
		<View
			style={[
				{
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					borderRadius: isSearch ? theme.radius.sm : theme.radius.md,
					backgroundColor: isSearch
						? theme.color.surfaceMuted
						: theme.color.canvas,
					borderWidth: isSearch ? 0 : 1,
					borderColor: isSearch ? undefined : borderColor,
					paddingHorizontal: isSearch ? 10 : 12,
					// Search sits inside a header seam; 8 keeps the shell ≥32pt tall
					// (desktop's `h-8`) without crowding the glyph.
					paddingVertical: isSearch ? 8 : 8,
					// Keep the native shadow container stable across focus. Adding
					// shadowColor only on focus can reparent the input in Fabric and
					// immediately resign first responder (RN #45798).
					shadowColor: theme.brand.violet,
					shadowOffset: { width: 0, height: 0 },
					shadowRadius: 3,
					shadowOpacity: focused && !isSearch ? 0.2 : 0,
				},
				containerStyle,
			]}
		>
			{leading}
			<Input
				key={fontScale}
				keyboardAppearance={theme.mode}
				// Keep search and picker controls visible beside landscape keyboards.
				disableFullscreenUI
				placeholderTextColor={theme.color.textMuted}
				onFocus={handleFocus}
				onBlur={handleBlur}
				style={[
					{
						flex: 1,
						padding: 0,
						margin: 0,
						color: theme.color.text,
						fontFamily: fontFamily.sans,
						fontSize: isSearch ? 14 : 16,
						lineHeight: 20,
					},
					inputStyle,
				]}
				{...rest}
				defaultValue={nativeDraft.current}
				onChangeText={(text) => {
					nativeDraft.current = text;
					onChangeText?.(text);
				}}
			/>
			{trailing}
		</View>
	);
}
