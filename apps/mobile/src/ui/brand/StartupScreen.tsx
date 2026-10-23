import { View } from "react-native";
import { useTheme } from "../theme";
import { AgentWelcomeHero } from "./AgentWelcomeHero";

export function StartupScreen() {
	const theme = useTheme();
	return (
		<View
			accessible
			accessibilityRole="progressbar"
			accessibilityLabel="Opening Cline"
			accessibilityState={{ busy: true }}
			style={{
				flex: 1,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: theme.color.canvas,
			}}
		>
			<View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={{ width: "100%", maxWidth: 400 }}
			>
				<AgentWelcomeHero height={160} variant="bot-only" />
			</View>
		</View>
	);
}
