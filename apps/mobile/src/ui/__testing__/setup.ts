/**
 * Vitest setup: mock every native module the UI kit imports so the render smoke
 * tests can mount components in a plain Node environment. The real RN + native
 * libraries ship Flow/native code vitest can't transform; mocking here means
 * vitest never loads them. Pure-TS suites (session/config/scripts) don't import
 * any of these, so the mocks are inert for them.
 *
 * The host-component factory lives in a `vi.hoisted` block (not an import) because
 * `vi.mock` factories are hoisted above imports and can only reference hoisted
 * values — a plain `require` of the `.tsx` helper from inside a factory fails.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

// Real-hub integration tests must never open the developer's agenda/event DBs.
// A per-worker data root keeps every implicit storage path inside /tmp; the task
// store is in-memory because it is created even when agenda tools are disabled.
process.env.CLINE_DATA_DIR = join(
	tmpdir(),
	`cline-mobile-vitest-${process.pid}-${process.env.VITEST_POOL_ID ?? "0"}`,
);
process.env.CLINE_TASKS_DB_PATH = ":memory:";

const { host, icon, flattenStyle, motion } = vi.hoisted(() => {
	const { createElement, forwardRef } = require("react");

	// Mutable so a test can render the reduced-motion branch; see
	// `setReducedMotion` in `render.tsx`.
	const motionPreference = { reduced: false };

	function makeHost(name: string) {
		const Host = forwardRef((props: Record<string, unknown>, _ref: unknown) => {
			const { style, children, ...rest } = props;
			const resolved =
				typeof style === "function"
					? (style as (s: { pressed: boolean }) => unknown)({ pressed: false })
					: style;
			// `Pressable` accepts a render-prop child; resolve it unpressed.
			const body =
				typeof children === "function"
					? (children as (s: { pressed: boolean }) => unknown)({
							pressed: false,
						})
					: children;
			return createElement(name, { ...rest, style: resolved }, body);
		});
		Host.displayName = name;
		return Host;
	}

	function makeIcon(name: string) {
		const Icon = (props: Record<string, unknown>) =>
			createElement("icon", { ...props, "data-name": name });
		Icon.displayName = name;
		return Icon;
	}

	function flatten(style: unknown): Record<string, unknown> {
		if (!style) {
			return {};
		}
		if (Array.isArray(style)) {
			return style.reduce(
				(acc: Record<string, unknown>, s: unknown) =>
					Object.assign(acc, flatten(s)),
				{},
			);
		}
		return typeof style === "object" ? (style as Record<string, unknown>) : {};
	}

	return {
		host: makeHost,
		icon: makeIcon,
		flattenStyle: flatten,
		motion: motionPreference,
	};
});

// Exposed on the global so test files can flip it without re-declaring the
// whole reanimated mock (a per-file `vi.mock` would replace this one wholesale).
(
	globalThis as { __clineMotionPreference?: { reduced: boolean } }
).__clineMotionPreference = motion;

vi.mock("react-native", () => {
	const Alert = {
		alert: (
			_title: string,
			_message?: string,
			buttons?: Array<{ style?: string; onPress?: () => void }>,
		) => buttons?.find((button) => button.style === "destructive")?.onPress?.(),
	};
	const StyleSheet = {
		create: <T>(styles: T): T => styles,
		flatten: (style: unknown) => flattenStyle(style),
		hairlineWidth: 1,
		absoluteFill: {
			position: "absolute",
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
		},
		absoluteFillObject: {
			position: "absolute",
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
		},
	};
	// A FlatList that actually walks `data` through `renderItem`, so screen smoke
	// tests exercise every row (a crash in an item component is then caught).
	const { createElement: h } = require("react");
	function FlatList(props: Record<string, unknown>) {
		const data = (props.data as unknown[]) ?? [];
		const renderItem = props.renderItem as
			| ((info: { item: unknown; index: number }) => unknown)
			| undefined;
		const keyExtractor = props.keyExtractor as
			| ((item: unknown, index: number) => string)
			| undefined;
		const children = renderItem
			? data.map((item, index) =>
					h(
						"View",
						{ key: keyExtractor ? keyExtractor(item, index) : String(index) },
						renderItem({ item, index }),
					),
				)
			: null;
		return h(
			"View",
			{
				style: props.style,
				"data-name": "FlatList",
				onScroll: props.onScroll,
				onScrollBeginDrag: props.onScrollBeginDrag,
				onLayout: props.onLayout,
				onContentSizeChange: props.onContentSizeChange,
				scrollEventThrottle: props.scrollEventThrottle,
			},
			props.ListHeaderComponent as unknown,
			children,
			props.ListEmptyComponent && data.length === 0
				? (props.ListEmptyComponent as unknown)
				: null,
			props.ListFooterComponent as unknown,
		);
	}
	FlatList.displayName = "FlatList";

	return {
		Alert,
		ActionSheetIOS: { showActionSheetWithOptions: vi.fn() },
		View: host("View"),
		Text: host("Text"),
		Pressable: host("Pressable"),
		TextInput: host("TextInput"),
		ScrollView: host("ScrollView"),
		Modal: host("Modal"),
		FlatList,
		KeyboardAvoidingView: host("KeyboardAvoidingView"),
		Image: host("Image"),
		ActivityIndicator: host("ActivityIndicator"),
		StyleSheet,
		Keyboard: {
			dismiss: () => {},
			isVisible: () => false,
			addListener: () => ({ remove: () => {} }),
		},
		AppState: {
			currentState: "active",
			addEventListener: vi.fn(() => ({ remove: () => {} })),
		},
		AccessibilityInfo: {
			announceForAccessibility: vi.fn(),
		},
		Linking: { openURL: vi.fn(async () => {}) },
		useWindowDimensions: () => ({
			width: 390,
			height: 844,
			scale: 2,
			fontScale: 1,
		}),
		Platform: {
			OS: "ios",
			select: (o: Record<string, unknown>) => o.ios ?? o.default,
		},
		useColorScheme: vi.fn(() => "dark"),
		Appearance: { setColorScheme: vi.fn() },
	};
});

vi.mock("react-native-reanimated", () => {
	const passthrough = <T>(v: T): T => v;
	const Easing = new Proxy(
		{},
		{
			get:
				() =>
				(...args: unknown[]) =>
					args,
		},
	);
	return {
		default: {
			createAnimatedComponent: <T>(component: T): T => component,
			View: host("Animated.View"),
			Text: host("Animated.Text"),
			ScrollView: host("Animated.ScrollView"),
		},
		useSharedValue: (initial: unknown) => ({ value: initial }),
		useAnimatedStyle: (fn: () => unknown) => fn(),
		useAnimatedProps: (fn: () => unknown) => fn(),
		useReducedMotion: () => motion.reduced,
		cancelAnimation: vi.fn(),
		withRepeat: passthrough,
		// A spy so tests can assert the duration/easing it was handed.
		withTiming: vi.fn(passthrough),
		withSpring: passthrough,
		// Delay is a wrapper; the inner animation's target value is what matters.
		// A spy so tests can assert the stagger schedule it was handed.
		withDelay: vi.fn((_delayMs: number, animation: unknown) => animation),
		Easing,
	};
});

vi.mock("expo-image-picker", () => ({
	launchImageLibraryAsync: vi.fn(async () => ({
		canceled: true,
		assets: null,
	})),
}));

vi.mock("expo-speech-recognition", () => ({
	ExpoSpeechRecognitionModule: {
		isRecognitionAvailable: () => true,
		requestPermissionsAsync: vi.fn(async () => ({
			granted: true,
			canAskAgain: true,
			status: "granted",
			expires: "never",
		})),
		start: vi.fn(),
		stop: vi.fn(),
		abort: vi.fn(),
	},
	// Pure UI render tests do not need a native emitter. Dictation ownership and
	// stale-result behavior are exercised in the focused core tests.
	useSpeechRecognitionEvent: () => {},
}));

vi.mock("react-native-svg", () => ({
	default: host("Svg"),
	Svg: host("Svg"),
	Path: host("Path"),
	Defs: host("Defs"),
	RadialGradient: host("RadialGradient"),
	LinearGradient: host("SvgLinearGradient"),
	Rect: host("Rect"),
	Circle: host("Circle"),
	Stop: host("Stop"),
	G: host("G"),
	Mask: host("Mask"),
	Pattern: host("Pattern"),
}));

// Static named imports (`import { Terminal } from …`) need enumerable exports,
// so build the mock from the icon set the kit + screens use (DESIGN_SPEC §7).
vi.mock("lucide-react-native", () => {
	const names = [
		"Terminal",
		"Files",
		"FileCode2",
		"SearchCode",
		"Pencil",
		"PanelsTopLeft",
		"Library",
		"User",
		"Users",
		"Box",
		"Blocks",
		"SquareArrowRight",
		"MessageCircleQuestionMark",
		"Wrench",
		"Brain",
		"ChevronDown",
		"ChevronRight",
		"ArrowUp",
		"ArrowRight",
		"ArrowLeft",
		"CircleStop",
		"Mic",
		"Square",
		"Paperclip",
		"Coins",
		"Cpu",
		"Check",
		"X",
		"Trash2",
		"Copy",
		"Undo",
		"Split",
		"MoreHorizontal",
		"Plus",
		"CornerUpLeft",
		"CornerDownRight",
		"CircleCheck",
		"CircleSlash",
		"CircleX",
		"Zap",
		"Bot",
		"Minus",
		"ExternalLink",
		"AppWindow",
		"ShieldAlert",
		"CircleHelp",
		"FileText",
		"ImageOff",
		"MessagesSquare",
		"Clock3",
		"Loader2",
		"AlertCircle",
		"Search",
		"Filter",
		"ArrowDownUp",
		"Star",
		"GitFork",
		"GitBranch",
		"ChevronLeft",
		"ListTree",
		"RefreshCw",
		"LogIn",
		"Cloud",
		"MonitorSmartphone",
		"Server",
		"Wifi",
		"Sparkles",
		// Chat state / banner vocabulary (DESIGN_SPEC §7 + connection-error kinds).
		"WifiOff",
		"Unplug",
		"Lock",
		"TriangleAlert",
		"CircleAlert",
		// Inline composer controls: the auto-approve pill/sheet and model pill.
		"ChevronUp",
		"ShieldCheck",
		// Session-first home + the handoff arrival surface.
		"Settings",
		"SlidersHorizontal",
		"Link2Off",
		// First-run intro screen + the QR scan entry points.
		"Camera",
		"QrCode",
		"PanelLeft",
		"PanelLeftClose",
	];
	const mod: Record<string, unknown> = { __esModule: true };
	for (const name of names) {
		mod[name] = icon(name);
	}
	return mod;
});

vi.mock("expo-linear-gradient", () => ({
	LinearGradient: host("LinearGradient"),
}));

vi.mock("@react-native-masked-view/masked-view", () => ({
	default: host("MaskedView"),
}));

vi.mock("expo-blur", () => ({ BlurView: host("BlurView") }));

vi.mock("expo-font", () => ({
	useFonts: () => [true, null],
	loadAsync: async () => undefined,
}));

// `fonts.ts` `require`s the .ttf binaries (a Metro asset ref) which vitest can't
// parse. Stub the module so importing the theme barrel stays render-safe.
vi.mock("@/ui/theme/fonts", () => ({
	fontAssets: {},
	useClineFonts: () => [true, null],
}));

vi.mock("@gorhom/bottom-sheet", () => ({
	default: host("BottomSheet"),
	BottomSheetView: host("BottomSheetView"),
	BottomSheetBackdrop: host("BottomSheetBackdrop"),
	BottomSheetModal: host("BottomSheetModal"),
	BottomSheetModalProvider: host("BottomSheetModalProvider"),
	BottomSheetScrollView: host("BottomSheetScrollView"),
	BottomSheetTextInput: host("BottomSheetTextInput"),
	useBottomSheet: () => ({ expand: () => {}, close: () => {} }),
}));

vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn(async () => true) }));

vi.mock("react-native-safe-area-context", () => ({
	SafeAreaProvider: host("SafeAreaProvider"),
	SafeAreaView: host("SafeAreaView"),
	useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock("react-native-gesture-handler", () => {
	class PanGesture {
		onEndCallback?: (event: {
			translationX: number;
			velocityX: number;
		}) => void;
		enabled() {
			return this;
		}
		activeOffsetX() {
			return this;
		}
		failOffsetX() {
			return this;
		}
		failOffsetY() {
			return this;
		}
		maxPointers() {
			return this;
		}
		runOnJS() {
			return this;
		}
		onEnd(callback: PanGesture["onEndCallback"]) {
			this.onEndCallback = callback;
			return this;
		}
	}
	return {
		GestureHandlerRootView: host("GestureHandlerRootView"),
		GestureDetector: host("GestureDetector"),
		Gesture: { Pan: () => new PanGesture() },
	};
});

// expo-router: screens use `useLocalSearchParams`, `useRouter` and `Stack`. Tests
// render screen components directly, so these are inert stubs.
vi.mock("expo-router", () => {
	const noopRouter = {
		push: () => {},
		replace: () => {},
		back: () => {},
		navigate: () => {},
		setParams: () => {},
	};
	const Stack = host("Stack") as unknown as {
		(props: Record<string, unknown>): unknown;
		Screen: unknown;
	};
	Stack.Screen = host("Stack.Screen");
	return {
		Stack,
		Link: host("Link"),
		Redirect: host("Redirect"),
		useRouter: () => noopRouter,
		router: noopRouter,
		useLocalSearchParams: () => ({}),
		usePathname: () => "/",
		useFocusEffect: (effect: () => void) =>
			require("react").useEffect(effect, [effect]),
		useNavigation: () => ({ setOptions: () => {} }),
		ThemeProvider: host("ExpoRouterThemeProvider"),
		DarkTheme: { dark: true, colors: {} },
	};
});

vi.mock("expo-document-picker", () => ({
	getDocumentAsync: vi.fn(async () => ({ canceled: true, assets: null })),
}));

vi.mock("expo-sharing", () => ({
	isAvailableAsync: vi.fn(async () => true),
	shareAsync: vi.fn(async () => {}),
}));

// Public optional navigation context used by responsive session drawer state.
vi.mock("expo-router/react-navigation", () => ({
	NavigationContext: require("react").createContext(undefined),
}));

vi.mock("expo-secure-store", () => ({
	getItemAsync: vi.fn(async () => null),
	setItemAsync: vi.fn(async () => {}),
	deleteItemAsync: vi.fn(async () => {}),
}));

vi.mock("expo-notifications", () => ({
	AndroidImportance: { HIGH: 4 },
	IosAuthorizationStatus: { PROVISIONAL: 3 },
	setNotificationChannelAsync: vi.fn(async () => {}),
	requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
	getPermissionsAsync: vi.fn(async () => ({ granted: true })),
	dismissAllNotificationsAsync: vi.fn(async () => {}),
	dismissNotificationAsync: vi.fn(async () => {}),
	cancelAllScheduledNotificationsAsync: vi.fn(async () => {}),
	cancelScheduledNotificationAsync: vi.fn(async () => {}),
	scheduleNotificationAsync: vi.fn(async () => "notification-1"),
	setNotificationHandler: vi.fn(),
	clearLastNotificationResponse: vi.fn(),
	getLastNotificationResponse: vi.fn(() => null),
	addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
}));

vi.mock("expo-file-system", () => ({
	Paths: { cache: "file:///cache" },
	Directory: class {
		uri: string;
		exists = false;
		constructor(...parts: Array<string | { uri: string }>) {
			this.uri = parts
				.map((part) => (typeof part === "string" ? part : part.uri))
				.join("/");
		}
		get name() {
			return this.uri.split("/").at(-1) ?? "";
		}
		create() {
			this.exists = true;
		}
		delete() {
			this.exists = false;
		}
		list() {
			return [];
		}
	},
	File: class {
		uri: string;
		exists = false;
		size = 0;
		constructor(...parts: Array<string | { uri: string }>) {
			this.uri = parts
				.map((part) => (typeof part === "string" ? part : part.uri))
				.join("/");
		}
		get name() {
			return this.uri.split("/").at(-1) ?? "";
		}
		create() {
			this.exists = true;
		}
		write(_content: string, _options?: unknown) {}
		delete() {
			this.exists = false;
		}
		async text() {
			return "";
		}
	},
}));

vi.mock("expo-audio", () => ({
	useAudioPlayer: vi.fn(() => {
		const { useMemo } = require("react");
		return useMemo(
			() => ({ play: vi.fn(), pause: vi.fn(), seekTo: vi.fn(async () => {}) }),
			[],
		);
	}),
	useAudioPlayerStatus: vi.fn(() => ({
		isLoaded: true,
		playing: false,
		currentTime: 0,
		duration: 12,
		didJustFinish: false,
		error: null,
	})),
}));

vi.mock("expo-video", () => ({
	VideoView: host("VideoView"),
	useVideoPlayer: vi.fn(
		(_source: unknown, setup?: (player: unknown) => void) => {
			const { useMemo } = require("react");
			return useMemo(() => {
				const player = {
					status: "readyToPlay",
					play: vi.fn(),
					pause: vi.fn(),
					addListener: vi.fn(() => ({ remove: vi.fn() })),
				};
				setup?.(player);
				return player;
			}, []);
		},
	),
}));

vi.mock("react-native-keyboard-controller", () => ({
	KeyboardProvider: host("KeyboardProvider"),
	KeyboardAvoidingView: host("KeyboardAvoidingView"),
	useReanimatedKeyboardAnimation: () => ({
		height: { value: 0 },
		progress: { value: 0 },
	}),
}));
