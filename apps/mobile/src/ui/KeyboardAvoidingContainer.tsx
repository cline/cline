import { useCallback, useRef, useState } from "react";
import {
	type LayoutChangeEvent,
	KeyboardAvoidingView as NativeKeyboardAvoidingView,
	Platform,
	type ViewProps,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

/** Android's edge-to-edge window stays full height while the IME is visible. */
export function KeyboardAvoidingContainer({ onLayout, ...props }: ViewProps) {
	const [ancestorOffset, setAncestorOffset] = useState(0);
	const layoutGeneration = useRef(0);
	const measureAncestor = useCallback(
		(event: LayoutChangeEvent) => {
			onLayout?.(event);
			const generation = ++layoutGeneration.current;
			const localY = event.nativeEvent.layout.y;
			// RN's avoidance calculation already includes its local frame.y. Only
			// add the ancestor's offset, including navigation and attention banners.
			event.target.measureInWindow((_x, windowY) => {
				if (generation !== layoutGeneration.current) return;
				if (!Number.isFinite(windowY) || !Number.isFinite(localY)) return;
				setAncestorOffset(windowY - localY);
			});
		},
		[onLayout],
	);

	return Platform.OS === "android" ? (
		<NativeKeyboardAvoidingView
			{...props}
			collapsable={false}
			behavior="padding"
			keyboardVerticalOffset={ancestorOffset}
			onLayout={measureAncestor}
		/>
	) : (
		<KeyboardAvoidingView
			{...props}
			behavior="padding"
			automaticOffset
			onLayout={onLayout}
		/>
	);
}
