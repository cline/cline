/** Quiet connect/hydrate state. The header already identifies the exact work. */

import { View } from "react-native";
import { Spinner, Text } from "@/ui";

export interface ChatConnectingStateProps {
	message?: string;
}

export function ChatConnectingState({ message }: ChatConnectingStateProps) {
	return (
		<View
			style={{
				flex: 1,
				alignItems: "center",
				justifyContent: "center",
				gap: 10,
				padding: 24,
			}}
		>
			<Spinner size={18} durationMs={1200} />
			<Text variant="small" tone="muted" style={{ textAlign: "center" }}>
				{message ?? "Opening session…"}
			</Text>
		</View>
	);
}
