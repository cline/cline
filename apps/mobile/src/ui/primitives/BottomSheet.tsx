import GorhomBottomSheet, {
	BottomSheetBackdrop,
	type BottomSheetBackdropProps,
	BottomSheetScrollView,
	BottomSheetView,
	type BottomSheetProps as GorhomBottomSheetProps,
} from "@gorhom/bottom-sheet";
import {
	createContext,
	forwardRef,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useState,
} from "react";
import { Keyboard, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";

export { BottomSheetView } from "@gorhom/bottom-sheet";

const BackdropActiveContext = createContext(false);

/** Gorhom renders this prop as a component type. Keep that type and its native
 * children stable while animations change touchability; swapping the type tears
 * down the animated GestureDetector hierarchy during Fabric mounting updates. */
function StableSheetBackdrop(props: BottomSheetBackdropProps) {
	const active = useContext(BackdropActiveContext);
	return (
		<View
			testID="sheet-backdrop-boundary"
			collapsable={false}
			pointerEvents={active ? "box-none" : "none"}
			accessibilityElementsHidden={!active}
			importantForAccessibility={active ? "auto" : "no-hide-descendants"}
			style={StyleSheet.absoluteFill}
		>
			<BottomSheetBackdrop
				{...props}
				appearsOnIndex={0}
				disappearsOnIndex={-1}
				opacity={active ? 0.5 : 0}
				accessible={active}
				enableTouchThrough={!active}
				pressBehavior="close"
			/>
		</View>
	);
}

export interface BottomSheetProps
	extends Omit<GorhomBottomSheetProps, "children"> {
	children: ReactNode;
	/** Render the dimming backdrop (rgba(0,0,0,.5)). Default true. */
	withBackdrop?: boolean;
	/** Use Gorhom's gesture-aware scroll container for content that can grow. */
	scrollable?: boolean;
}

/**
 * Open a sheet only after the software keyboard has finished leaving the screen.
 * Calling `dismiss()` and `expand()` in the same frame races UIKit's keyboard
 * animation and can leave the sheet underneath the keyboard.
 */
export function expandBottomSheetAfterKeyboardDismiss(
	sheetRef: RefObject<Pick<GorhomBottomSheet, "expand"> | null>,
): void {
	if (!Keyboard.isVisible()) {
		sheetRef.current?.expand();
		return;
	}
	let opened = false;
	let fallback: ReturnType<typeof setTimeout> | undefined;
	let subscription: { remove(): void } | undefined;
	const open = () => {
		if (opened) return;
		opened = true;
		subscription?.remove();
		if (fallback) clearTimeout(fallback);
		sheetRef.current?.expand();
	};
	subscription = Keyboard.addListener("keyboardDidHide", open);
	Keyboard.dismiss();
	// Defensive fallback for keyboards that fail to publish didHide.
	fallback = setTimeout(open, 650);
}

/**
 * Themed wrapper over `@gorhom/bottom-sheet`. Applies the Cline `popover`
 * surface, top `radius.lg` corners, a muted drag handle and a 50%-black backdrop
 * (DESIGN_SPEC §6). Requires a `GestureHandlerRootView` at the app root.
 * Forwards its ref so callers can `expand()`/`close()`.
 */
export const BottomSheet = forwardRef<GorhomBottomSheet, BottomSheetProps>(
	function BottomSheet(
		{
			children,
			withBackdrop = true,
			scrollable = false,
			onAnimate,
			onChange,
			...rest
		},
		ref,
	) {
		const theme = useTheme();
		const insets = useSafeAreaInsets();
		const { height } = useWindowDimensions();
		const paddingBottom = Math.max(16, insets.bottom + 8);
		// Resizing a closed sheet can leave its interpolated animatedIndex just
		// above -1. Gorhom then makes an invisible backdrop intercept every tap.
		// Guard touchability at a stable parent, independently of that interpolation.
		const [backdropActive, setBackdropActive] = useState(
			(rest.index ?? 0) >= 0,
		);
		const handleAnimate = useCallback<
			NonNullable<GorhomBottomSheetProps["onAnimate"]>
		>(
			(...args) => {
				if (args[1] >= 0) setBackdropActive(true);
				onAnimate?.(...args);
			},
			[onAnimate],
		);
		const handleChange = useCallback<
			NonNullable<GorhomBottomSheetProps["onChange"]>
		>(
			(...args) => {
				setBackdropActive(args[0] >= 0);
				onChange?.(...args);
			},
			[onChange],
		);

		return (
			<BackdropActiveContext.Provider value={backdropActive}>
				<GorhomBottomSheet
					ref={ref}
					topInset={insets.top}
					keyboardBlurBehavior="restore"
					enableBlurKeyboardOnGesture
					maxDynamicContentSize={height - insets.top - 16}
					// Keep the content's buttons reachable by VoiceOver. Grouping the
					// whole sheet as one adjustable element hides its descendants on iOS.
					accessible={false}
					backgroundStyle={{
						// `--popover`, one step above a card: desktop floats panels on the
						// popover surface, not the card surface.
						backgroundColor: theme.color.popover,
						borderTopLeftRadius: theme.radius.lg,
						borderTopRightRadius: theme.radius.lg,
					}}
					handleIndicatorStyle={{ backgroundColor: theme.color.textMuted }}
					backdropComponent={withBackdrop ? StableSheetBackdrop : undefined}
					{...rest}
					onAnimate={handleAnimate}
					onChange={handleChange}
				>
					{scrollable ? (
						<BottomSheetScrollView
							style={{ maxHeight: Math.min(640, height - insets.top - 48) }}
							contentContainerStyle={{ padding: 16, paddingBottom }}
							keyboardShouldPersistTaps="handled"
						>
							{children}
						</BottomSheetScrollView>
					) : (
						<BottomSheetView style={{ padding: 16, paddingBottom }}>
							{children}
						</BottomSheetView>
					)}
				</GorhomBottomSheet>
			</BackdropActiveContext.Provider>
		);
	},
);
