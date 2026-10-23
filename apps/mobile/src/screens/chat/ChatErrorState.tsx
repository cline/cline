/**
 * The Chat screen's connection-failure state (DESIGN_SPEC §3 empty-state
 * geometry + §2 medallion/card language).
 *
 * Structure, in priority order: a tinted icon medallion, a short human headline,
 * one line of explanation, a primary `Retry`, a secondary escape back to the
 * session list, and — demoted into a collapsed `Details` disclosure — the raw
 * technical string in a mono `CodeBlock`. The raw error is never the headline.
 *
 * Which of the six variants renders (and whether `Retry` is offered at all) is
 * decided by {@link describeConnectionError}; see that module for exactly which
 * failures the connection layer lets us tell apart.
 */

import type { LucideIcon } from "lucide-react-native";
import {
	CircleAlert,
	Clock3,
	Lock,
	RefreshCw,
	TriangleAlert,
	Unplug,
	WifiOff,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { userErrorMessage } from "@/error-message";
import type { IconBadgeTone } from "@/ui";
import {
	Button,
	CodeBlock,
	Disclosure,
	IconBadge,
	StateView,
	Text,
	useTheme,
} from "@/ui";
import {
	type ConnectionErrorKind,
	describeConnectionError,
} from "./connection-error";

interface KindVisual {
	icon: LucideIcon;
	tone: Extract<IconBadgeTone, "danger" | "warning">;
}

/** Icons are from the DESIGN_SPEC §7 vocabulary (`Clock3` = stalled, etc.). */
const VISUAL: Record<ConnectionErrorKind, KindVisual> = {
	missing: { icon: CircleAlert, tone: "warning" },
	unreachable: { icon: WifiOff, tone: "danger" },
	timeout: { icon: Clock3, tone: "warning" },
	dropped: { icon: Unplug, tone: "warning" },
	refused: { icon: Lock, tone: "danger" },
	github: { icon: Lock, tone: "warning" },
	protocol: { icon: TriangleAlert, tone: "warning" },
	unknown: { icon: CircleAlert, tone: "danger" },
};

export interface ChatErrorStateProps {
	error?: Error;
	onRetry: () => void | Promise<void>;
	/** Escape hatch back to the session list. Omitted hides the secondary action. */
	onChooseAnotherSession?: () => void;
	connectionKind?: "local" | "cloud";
	onSignIn?: () => void | Promise<void>;
	onConnectGitHub?: () => void | Promise<void>;
	onNewChat?: () => void;
}

export function ChatErrorState({
	error,
	onRetry,
	onChooseAnotherSession,
	connectionKind,
	onSignIn,
	onConnectGitHub,
	onNewChat,
}: ChatErrorStateProps) {
	const theme = useTheme();
	const { height, width } = useWindowDimensions();
	const compact = height < 500 && width > height;
	const { kind, headline, body, detail, retryable, action } =
		describeConnectionError(error, connectionKind);
	const { icon: Icon, tone } = VISUAL[kind];
	const [retrying, setRetrying] = useState(false);
	const [actionError, setActionError] = useState<string>();
	const retryingRef = useRef(false);
	// A successful retry unmounts this screen mid-promise; don't set state after.
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const retry = async (operation: () => void | Promise<void> = onRetry) => {
		if (retryingRef.current) return;
		retryingRef.current = true;
		setRetrying(true);
		setActionError(undefined);
		try {
			await operation();
		} catch (cause) {
			if (mounted.current)
				setActionError(
					userErrorMessage(cause, "Couldn't complete this action. Try again."),
				);
		} finally {
			retryingRef.current = false;
			if (mounted.current) {
				setRetrying(false);
			}
		}
	};
	const recovery =
		action === "sign-in" && onSignIn
			? { label: "Sign in", run: onSignIn }
			: action === "connect-github" && onConnectGitHub
				? { label: "Connect GitHub", run: onConnectGitHub }
				: action === "new-chat" && onNewChat
					? { label: "New chat", run: onNewChat }
					: undefined;

	const actions = (
		<>
			<View
				style={{
					flexDirection: "row",
					flexWrap: "wrap",
					justifyContent: "center",
					gap: 8,
				}}
			>
				{recovery ? (
					<Button
						label={recovery.label}
						variant="primary"
						loading={retrying}
						onPress={() => void retry(recovery.run)}
					/>
				) : null}
				{retryable ? (
					<Button
						label="Retry"
						variant={recovery ? "secondary" : "primary"}
						icon={<RefreshCw size={14} color={theme.brand.onViolet} />}
						loading={retrying}
						loadingLabel="Retrying…"
						onPress={() => void retry()}
					/>
				) : null}
				{onChooseAnotherSession ? (
					<Button
						label="Choose another session"
						variant={retryable ? "secondary" : "primary"}
						onPress={onChooseAnotherSession}
					/>
				) : null}
			</View>
			{actionError ? (
				<Text tone="danger" accessibilityRole="alert">
					{actionError}
				</Text>
			) : null}
			{kind === "protocol" ? (
				<Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
					Retrying won't help until one side is updated.
				</Text>
			) : null}
		</>
	);
	const details = detail ? (
		<Disclosure
			label="Details"
			variant="inset"
			indent={0}
			accessibilityLabel="Technical error details"
			labelColor={theme.color.textMuted}
		>
			<CodeBlock wrap muted maxHeight={160}>
				{detail}
			</CodeBlock>
		</Disclosure>
	) : null;

	return (
		// Keep recovery and expanded details reachable with larger accessibility text.
		<ScrollView
			style={{ flex: 1 }}
			contentContainerStyle={{ flexGrow: 1 }}
			keyboardShouldPersistTaps="handled"
		>
			{compact ? (
				<View
					style={{
						flexGrow: 1,
						justifyContent: "center",
						paddingHorizontal: 16,
						paddingVertical: 12,
						gap: 12,
					}}
				>
					<View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
						<IconBadge tone={tone} size={36} radius={10} bordered>
							<Icon size={20} color={theme.feedback[tone].fg} />
						</IconBadge>
						<View style={{ flex: 1, gap: 4 }}>
							<Text variant="heading">{headline}</Text>
							<Text tone="muted">{body}</Text>
						</View>
					</View>
					{actions}
					{details}
				</View>
			) : (
				<StateView
					icon={<Icon size={24} color={theme.feedback[tone].fg} />}
					tone={tone}
					headline={headline}
					body={body}
					footer={details}
				>
					{actions}
				</StateView>
			)}
		</ScrollView>
	);
}
