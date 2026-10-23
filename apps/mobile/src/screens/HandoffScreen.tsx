/**
 * Arrival surface for `clinecode://handoff?...` — the machine-initiated handoff.
 *
 * The user was working in Cline on their computer, typed `/handoff`, and opened
 * the link it produced. From here they should land *in the session*, so this screen
 * is a transition, not a destination: validate, save the endpoint under the
 * computer's own name, and go.
 *
 * The logic lives in a screen rather than in the route file so it is testable:
 * `app/handoff.tsx` only supplies params and navigation.
 *
 * Failure is a first-class case and always a sentence, never a stack trace: an
 * expired link (the common one — these links are short-lived by design) says to run
 * `/handoff` again; a damaged or unknown-version link says which part could not be
 * read. Nothing is saved when validation fails.
 */

import { Link2Off } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type ConnectionDescriptor, descriptorKey } from "@/connection";
import { pairHandoffLink } from "@/connection/relay-connection";
import { userErrorMessage } from "@/error-message";
import { useEndpoints } from "@/state/endpoints";
import {
	decodeHandoffParams,
	type HandoffLink,
	HandoffLinkError,
	type HandoffParams,
} from "@/state/handoff-link";
import { useLastOpened } from "@/state/last-opened";
import { Button, Spinner, StateView, Text, useTheme } from "@/ui";

export interface HandoffScreenProps {
	/** Query params of the handoff link, straight off the router. */
	params: HandoffParams;
	/**
	 * Open the session the link pointed at. `hubSessionId` is the machine's `sid`
	 * when it sent one — the caller decides what to do with it.
	 */
	onOpenSession(descriptor: ConnectionDescriptor): void;
	/** The link paired a machine but named no session: go to the session list. */
	onPaired(descriptor: ConnectionDescriptor): void;
	/** Give up on a bad link. */
	onDismiss(): void;
	/** Injectable clock so expiry is deterministic in tests. */
	now?: number;
	/** Test seam; production performs the real relay + Noise ceremony. */
	pair?: (link: HandoffLink) => Promise<ConnectionDescriptor>;
}

type HandoffState =
	| { phase: "working"; machineName?: string }
	| { phase: "error"; message: string };

export function HandoffScreen({
	params,
	onOpenSession,
	onPaired,
	onDismiss,
	now,
	pair = pairHandoffLink,
}: HandoffScreenProps) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const { save } = useEndpoints();
	const { touch } = useLastOpened();
	const [state, setState] = useState<HandoffState>({ phase: "working" });

	// A handoff link is single-use and this screen navigates away on success, so it
	// must run exactly once per mount — a re-render (or React 19 StrictMode's
	// double effect) must not re-save or double-navigate.
	const handled = useRef(false);

	useEffect(() => {
		if (handled.current) {
			return;
		}
		handled.current = true;

		let link: HandoffLink;
		try {
			link = decodeHandoffParams(params, now !== undefined ? { now } : {});
		} catch (error) {
			setState({
				phase: "error",
				message:
					error instanceof HandoffLinkError
						? error.message
						: "This handoff link could not be read. Run /handoff in Cline on your computer to get a fresh link.",
			});
			return;
		}

		setState({ phase: "working", machineName: link.machineName });
		void (async () => {
			try {
				const descriptor = await pair(link);
				const key = descriptorKey(descriptor);
				await save(descriptor);
				await touch(key).catch(() => {});
				if (descriptor.hubSessionId) {
					onOpenSession(descriptor);
				} else {
					onPaired(descriptor);
				}
			} catch (error) {
				setState({
					phase: "error",
					message: userErrorMessage(
						error,
						"Secure pairing failed. Run /handoff again and retry.",
					),
				});
			}
		})();
	}, [params, now, pair, save, touch, onOpenSession, onPaired]);

	if (state.phase === "error") {
		return (
			<ScrollView
				style={{ flex: 1, backgroundColor: theme.color.canvas }}
				contentContainerStyle={{
					flexGrow: 1,
					paddingTop: insets.top,
					paddingBottom: insets.bottom,
					paddingLeft: insets.left,
					paddingRight: insets.right,
					backgroundColor: theme.color.canvas,
					justifyContent: "center",
				}}
			>
				<StateView
					icon={<Link2Off size={24} color={theme.color.danger} />}
					tone="danger"
					headline="This handoff link didn’t work"
					body={state.message}
				>
					<Button label="Back to sessions" fullWidth onPress={onDismiss} />
				</StateView>
			</ScrollView>
		);
	}

	return (
		<View
			style={{
				flex: 1,
				paddingTop: insets.top,
				paddingBottom: insets.bottom,
				paddingLeft: insets.left + 24,
				paddingRight: insets.right + 24,
				backgroundColor: theme.color.canvas,
				alignItems: "center",
				justifyContent: "center",
				gap: 12,
			}}
		>
			<Spinner />
			<Text variant="body" tone="muted">
				{state.machineName
					? `Connecting to ${state.machineName}…`
					: "Opening handoff…"}
			</Text>
		</View>
	);
}
