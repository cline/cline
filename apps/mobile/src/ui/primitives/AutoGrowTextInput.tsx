import { useRef, useState } from "react";
import {
	type NativeSyntheticEvent,
	TextInput,
	type TextInputContentSizeChangeEventData,
	type TextInputProps,
} from "react-native";
import { fontFamily, useTheme } from "../theme";

export interface AutoGrowTextInputProps extends TextInputProps {
	/** Collapsed height (px). Default 20 (one line). */
	minHeight?: number;
	/** Max height before it starts scrolling (px). Default 240. */
	maxHeight?: number;
}

/**
 * Multiline input that grows with its content between `minHeight` and
 * `maxHeight`, then scrolls — the composer textarea (DESIGN_SPEC §5). Measures
 * via `onContentSizeChange` and clamps.
 */
export function AutoGrowTextInput({
	minHeight = 20,
	maxHeight = 240,
	onContentSizeChange,
	onBlur,
	onFocus,
	onPressIn,
	style,
	...rest
}: AutoGrowTextInputProps) {
	const theme = useTheme();
	const [height, setHeight] = useState(minHeight);
	const inputRef = useRef<TextInput>(null);

	const handleContentSizeChange = (
		e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>,
	) => {
		const next = Math.min(
			maxHeight,
			Math.max(minHeight, e.nativeEvent.contentSize.height),
		);
		setHeight(next);
		onContentSizeChange?.(e);
	};

	return (
		<TextInput
			keyboardAppearance={theme.mode}
			ref={inputRef}
			multiline
			scrollEnabled={height >= maxHeight}
			placeholderTextColor={theme.color.textMuted}
			onContentSizeChange={handleContentSizeChange}
			onFocus={(event) => {
				onFocus?.(event);
			}}
			onBlur={(event) => {
				onBlur?.(event);
			}}
			onPressIn={(event) => {
				inputRef.current?.focus();
				onPressIn?.(event);
			}}
			style={[
				{
					// Let native text measurement grow the field. In Fabric, pinning
					// height prevents a layout change and can suppress the very
					// content-size event needed to discover wrapped lines.
					minHeight,
					maxHeight,
					padding: 0,
					margin: 0,
					color: theme.color.text,
					fontFamily: fontFamily.sans,
					fontSize: 16,
					lineHeight: 20,
					textAlignVertical: "top",
				},
				style,
			]}
			{...rest}
		/>
	);
}
