/** First-run remote-control action. Cline account status lives above this state. */

import { QrCode } from "lucide-react-native";
import { View } from "react-native";
import { Button, CommandLine, StateView, useTheme } from "@/ui";

/** The one instruction that turns a computer into a session on this device. */
export const HANDOFF_INSTRUCTION = "/handoff";

export function PairComputerState({ onPair }: { onPair?: () => void }) {
	const theme = useTheme();
	return (
		<StateView
			icon={<QrCode size={24} color={theme.brand.violet} />}
			headline="Connect Your Computer"
			body="On your computer, open Cline, start or resume a conversation, then enter /handoff. When its QR code appears, scan it here."
		>
			<View style={{ gap: 12, alignItems: "center" }}>
				<CommandLine
					accessibilityLabel={`Run the command ${HANDOFF_INSTRUCTION} in Cline on your computer. Touch and hold to copy.`}
				>
					{HANDOFF_INSTRUCTION}
				</CommandLine>
				{onPair ? (
					<Button
						label="Scan QR Code"
						icon={<QrCode size={15} color={theme.brand.onViolet} />}
						onPress={onPair}
					/>
				) : null}
			</View>
		</StateView>
	);
}
