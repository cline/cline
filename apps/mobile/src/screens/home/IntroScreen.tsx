/**
 * Home keeps the composer mounted while contextual setup replaces it, so drafts
 * and attachments survive account and repository setup.
 */

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	Keyboard,
	type NativeSyntheticEvent,
	type NativeTouchEvent,
	Platform,
	ScrollView,
	StyleSheet,
	Text,
	useWindowDimensions,
	View,
} from "react-native";
import {
	KeyboardAvoidingView,
	useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Animated, {
	useAnimatedStyle,
	useReducedMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentWelcomeHero } from "@/ui";

export const HANDOFF_INSTRUCTION = "/handoff";

const CONTENT_PAD_X = 16;

export interface IntroScreenProps {
	contextControl: ReactNode;
	composer: ReactNode;
	setup?: ReactNode;
	notice?: ReactNode;
	progress?: ReactNode;
}

/** Shared native counterpart to Desktop's interactive welcome-hero pointer. */
export function useWelcomeEyeTracking() {
	const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
	const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const { width, height } = useWindowDimensions();
	const reduceMotion = useReducedMotion();
	useEffect(
		() => () => {
			if (settleTimer.current) clearTimeout(settleTimer.current);
		},
		[],
	);
	const onTouchStart = (event: NativeSyntheticEvent<NativeTouchEvent>) => {
		if (reduceMotion || width <= 0 || height <= 0) return;
		const deltaX = event.nativeEvent.pageX - width / 2;
		const deltaY = event.nativeEvent.pageY - height / 2;
		const distance = Math.hypot(deltaX, deltaY);
		const strength = Math.min(distance / 220, 1) * 6;
		setEyeOffset({
			x: distance === 0 ? 0 : (deltaX / distance) * strength,
			y: distance === 0 ? 0 : (deltaY / distance) * strength,
		});
		if (settleTimer.current) clearTimeout(settleTimer.current);
		settleTimer.current = setTimeout(() => setEyeOffset({ x: 0, y: 0 }), 650);
	};
	return { eyeOffset, onTouchStart };
}

export function IntroScreen({
	contextControl,
	composer,
	setup,
	notice,
	progress,
}: IntroScreenProps) {
	const [keyboardVisible, setKeyboardVisible] = useState(false);
	const scrollRef = useRef<ScrollView>(null);
	const window = useWindowDimensions();
	const compactKeyboard = keyboardVisible && window.height < 500;
	const insets = useSafeAreaInsets();
	const welcomeEyes = useWelcomeEyeTracking();
	const keyboard = useReanimatedKeyboardAnimation();
	const heroHeight = window.height < 500 ? 0 : setup ? 140 : 160;
	const heroSpacingStyle = useAnimatedStyle(() => ({
		marginBottom:
			!setup && heroHeight > 0 ? 20 * (1 - keyboard.progress.value) : 0,
	}));
	const bottomSpaceStyle = useAnimatedStyle(() => ({
		flexGrow: 1 - keyboard.progress.value,
		height: (Math.max(insets.bottom, 12) - 8) * (1 - keyboard.progress.value),
	}));
	useEffect(() => {
		const show = Keyboard.addListener(
			Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
			() => setKeyboardVisible(true),
		);
		const hide = Keyboard.addListener(
			Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
			() => setKeyboardVisible(false),
		);
		return () => {
			show.remove();
			hide.remove();
		};
	}, []);
	const revealComposer = () => {
		if (keyboardVisible) scrollRef.current?.scrollToEnd({ animated: false });
	};
	return (
		<KeyboardAvoidingView
			onTouchStart={welcomeEyes.onTouchStart}
			style={{ flex: 1 }}
			automaticOffset
			// Edge-to-edge Android windows need explicit keyboard avoidance too.
			behavior={Platform.OS === "ios" ? "padding" : "height"}
		>
			<ScrollView
				ref={scrollRef}
				onLayout={revealComposer}
				onContentSizeChange={revealComposer}
				style={{ flex: 1 }}
				contentContainerStyle={{
					flexGrow: 1,
					justifyContent: "center",
					paddingHorizontal: CONTENT_PAD_X,
					paddingTop: 8,
					paddingBottom: 8,
				}}
				keyboardDismissMode="interactive"
				keyboardShouldPersistTaps="handled"
			>
				<Text
					accessible
					accessibilityLabel={
						setup ? "Set up Cline Cloud" : "What would you like to build?"
					}
					accessibilityRole="header"
					style={styles.screenReaderOnly}
				>
					What would you like to build?
				</Text>
				<View style={{ flexGrow: 1 }} />
				<Animated.View style={heroSpacingStyle}>
					{heroHeight > 0 ? (
						<AgentWelcomeHero
							eyeOffset={welcomeEyes.eyeOffset}
							height={heroHeight}
						/>
					) : null}
				</Animated.View>
				{progress ? <View style={{ marginBottom: 24 }}>{progress}</View> : null}
				<View
					style={{
						display: compactKeyboard && !setup ? "none" : "flex",
						width: "100%",
						maxWidth: setup ? 760 : undefined,
						alignSelf: "center",
						marginTop: setup ? 12 : 0,
					}}
				>
					{contextControl}
				</View>
				{setup ? (
					<View
						style={{
							marginTop: 12,
							width: "100%",
							maxWidth: 760,
							alignSelf: "center",
						}}
					>
						{setup}
					</View>
				) : null}
				<View
					style={{
						display: setup ? "none" : "flex",
						marginTop: compactKeyboard ? 0 : 8,
						gap: 12,
					}}
				>
					{notice}
					{composer}
				</View>
				<Animated.View style={bottomSpaceStyle} />
			</ScrollView>
		</KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	screenReaderOnly: {
		position: "absolute",
		width: 1,
		height: 1,
		overflow: "hidden",
		color: "transparent",
		fontSize: 1,
		lineHeight: 1,
	},
});
