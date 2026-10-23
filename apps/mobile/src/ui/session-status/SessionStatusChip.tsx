import { useEffect } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import Animated, {
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";
import type { RemoteSessionStatus, RunStatus } from "@/session";
import { Chip } from "../primitives/Chip";
import { StatusDot, type StatusTone } from "../primitives/StatusDot";
import { Text } from "../primitives/Text";

/**
 * Every status the chip understands — the run-level `RunStatus` and the
 * cloud-session `RemoteSessionStatus` from the session core (DESIGN_SPEC §3).
 */
export type SessionStatus = RunStatus | RemoteSessionStatus;

interface Presentation {
	tone: StatusTone;
	label: string;
}

/**
 * Status → tone + label. Only `running` is green and only `failed` is red; every
 * other state is neutral with its dot hidden (desktop SessionStatus CSS).
 * Violet is reserved for interactive accents elsewhere.
 */
const PRESENTATION: Record<SessionStatus, Presentation> = {
	unknown: { tone: "neutral", label: "Status unavailable" },
	// RunStatus
	idle: { tone: "neutral", label: "Idle" },
	running: { tone: "running", label: "Running" },
	completed: { tone: "neutral", label: "Completed" },
	aborted: { tone: "neutral", label: "Stopped" },
	failed: { tone: "error", label: "Failed" },
	// RemoteSessionStatus (adds these; `running`/`failed` shared above)
	provisioning: { tone: "neutral", label: "Starting" },
	stopped: { tone: "neutral", label: "Stopped" },
	suspended: { tone: "neutral", label: "Paused" },
	expired: { tone: "neutral", label: "Expired" },
};

export interface SessionStatusChipProps {
	status: SessionStatus;
	/** Sidebar activity marker; running takes priority, as on desktop. */
	unread?: boolean;
	/** Desktop's sidebar has different indicator priority from its chat header. */
	sidebar?: boolean;
	pending?: boolean;
	/** Render just the dot (no pill/label) — for tight session rows. */
	dotOnly?: boolean;
	/** Render desktop's quiet dot + label metadata, without a filled pill. */
	plain?: boolean;
	/** Override the default label text. */
	label?: string;
	style?: StyleProp<ViewStyle>;
}

/** Session status as a dot + label pill (or a bare dot when `dotOnly`). */
export function SessionStatusChip({
	status,
	unread = false,
	sidebar = false,
	pending = false,
	dotOnly = false,
	plain = false,
	label,
	style,
}: SessionStatusChipProps) {
	const { tone, label: defaultLabel } = PRESENTATION[status];
	const dotTone = sidebar
		? pending || status === "provisioning"
			? "pending"
			: status === "running"
				? "running"
				: unread
					? "unread"
					: "neutral"
		: tone === "running"
			? tone
			: unread
				? "unread"
				: tone;
	// Desktop SessionStatus reserves a 6px slot but hides neutral dots.
	// Keep labels readable: Completed and Paused still describe different states.
	const dot =
		sidebar && status === "provisioning" && !pending ? (
			<ProvisioningDot />
		) : (
			<StatusDot
				tone={dotTone}
				size={6}
				style={{ opacity: dotTone === "neutral" ? 0 : 1 }}
			/>
		);

	if (dotOnly) {
		return <View style={style}>{dot}</View>;
	}

	if (plain) {
		return (
			<View
				accessible
				accessibilityLabel={label ?? defaultLabel}
				style={[{ flexDirection: "row", alignItems: "center", gap: 6 }, style]}
			>
				{dot}
				<Text variant="caption" tone="muted">
					{label ?? defaultLabel}
				</Text>
			</View>
		);
	}

	return (
		<Chip leading={dot} style={style}>
			<Text variant="small" tone="muted">
				{label ?? defaultLabel}
			</Text>
		</Chip>
	);
}

function ProvisioningDot() {
	const reducedMotion = useReducedMotion();
	const opacity = useSharedValue(1);
	useEffect(() => {
		opacity.value = reducedMotion
			? 1
			: withRepeat(withTiming(0.5, { duration: 1000 }), -1, true);
		return () => {
			opacity.value = 1;
		};
	}, [opacity, reducedMotion]);
	const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
	return (
		<Animated.View style={style}>
			<StatusDot tone="pending" size={6} />
		</Animated.View>
	);
}
