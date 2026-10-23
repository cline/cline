import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const SESSION_SIDEBAR_WIDTH = 280;
// A pinned sidebar needs room for a comfortable chat, not just a rotated phone.
const MIN_CHAT_WIDTH = 640;

export function isWideSessionLayout(width: number, left = 0, right = 0) {
	return width - left - right >= SESSION_SIDEBAR_WIDTH + MIN_CHAT_WIDTH;
}

/** UI state only: resizing must never change route or connection identity. */
export function useAdaptiveSessionLayout() {
	const { width } = useWindowDimensions();
	const insets = useSafeAreaInsets();
	const wide = isWideSessionLayout(width, insets.left, insets.right);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [collapsed, setCollapsed] = useState(false);
	const previousWide = useRef(wide);
	useEffect(() => {
		if (previousWide.current !== wide) setDrawerOpen(false);
		previousWide.current = wide;
	}, [wide]);
	const open = useCallback(() => {
		if (wide) setCollapsed(false);
		else setDrawerOpen(true);
	}, [wide]);
	const close = useCallback(() => {
		if (wide) setCollapsed(true);
		else setDrawerOpen(false);
	}, [wide]);
	return {
		wide,
		open,
		close,
		setDrawerOpen,
		// A stale drawer must not reappear even for one render after folding.
		visible: wide ? !collapsed : previousWide.current === wide && drawerOpen,
	};
}

/** Fixed slots keep the chat/composer mounted on fold, resize and collapse. */
export function AdaptiveSessionLayout({
	inlineSidebar,
	onOpenSidebar,
	sidebar,
	children,
}: {
	inlineSidebar: boolean;
	onOpenSidebar?: () => void;
	sidebar: ReactNode;
	children: ReactNode;
}) {
	const insets = useSafeAreaInsets();
	const openGesture = Gesture.Pan()
		.enabled(!inlineSidebar && Boolean(onOpenSidebar))
		.activeOffsetX(24)
		.failOffsetX(-8)
		.failOffsetY([-16, 16])
		.maxPointers(1)
		.runOnJS(true)
		.onEnd((event) => {
			if (event.translationX > 64 || event.velocityX > 450) onOpenSidebar?.();
		});
	return (
		<View
			style={{
				flex: 1,
				flexDirection: "row",
				paddingLeft: insets.left,
				paddingRight: insets.right,
			}}
		>
			<View
				testID="session-sidebar-slot"
				style={{ width: inlineSidebar ? SESSION_SIDEBAR_WIDTH : 0 }}
			>
				{sidebar}
			</View>
			<GestureDetector gesture={openGesture}>
				<View
					collapsable={false}
					testID="session-main-pane"
					style={{ flex: 1, minWidth: 0 }}
				>
					{children}
				</View>
			</GestureDetector>
		</View>
	);
}
