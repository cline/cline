import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import {
	DarkTheme,
	DefaultTheme,
	ThemeProvider as NavThemeProvider,
	Stack,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useEffect } from "react";
import { LogBox } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { COMPUTER_CONNECTIONS_ENABLED } from "@/config/features";
import { CloudAuthProvider } from "@/state/cloud-auth";
import { EndpointsProvider } from "@/state/endpoints";
import { ExecutionTargetsProvider } from "@/state/execution-targets";
import { LastOpenedProvider } from "@/state/last-opened";
import { SettingsProvider, useApprovalPolicy } from "@/state/settings";
import { StartupScreen, useTheme, useClineFonts } from "@/ui";

import { AppearanceProvider, useAppearance } from "@/state/appearance";

void SplashScreen.preventAutoHideAsync();

if (__DEV__) {
	// Expo's native websocket/animation emitters warn when an event lands during
	// listener teardown. They are benign, but LogBox's persistent bottom toast
	// sits directly over the chat composer and consumes its taps. Ignore only
	// these exact native-emitter messages; all application warnings stay visible.
	LogBox.ignoreLogs([
		"Sending `websocketClosed` with no listeners registered.",
		"Sending `websocketMessage` with no listeners registered.",
		"Sending `onAnimatedValueUpdate` with no listeners registered.",
	]);
}

function RestoredSettings({ children }: { children: ReactNode }) {
	const { hydrated } = useApprovalPolicy();
	return hydrated ? children : <StartupScreen />;
}

export default function RootLayout() {
	return (
		<AppearanceProvider>
			<AppLayout />
		</AppearanceProvider>
	);
}

function AppLayout() {
	const theme = useTheme();
	const { hydrated: appearanceReady } = useAppearance();
	const base = theme.mode === "dark" ? DarkTheme : DefaultTheme;
	const navigationTheme = {
		...base,
		colors: {
			...base.colors,
			primary: theme.brand.primary,
			background: theme.color.canvas,
			card: theme.color.surface,
			text: theme.color.text,
			border: theme.color.border,
			notification: theme.color.danger,
		},
	};
	const [fontsLoaded, fontError] = useClineFonts();
	const fontsReady = fontsLoaded || fontError !== null;
	useEffect(() => {
		if (fontsReady && appearanceReady) SplashScreen.hide();
	}, [fontsReady, appearanceReady]);

	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			<SafeAreaProvider>
				<KeyboardProvider>
					<EndpointsProvider>
						<ExecutionTargetsProvider>
							{/* Session recency ("Opened 5m ago") is device-observed state, so it
						    sits beside the endpoints it annotates. */}
							<LastOpenedProvider>
								<CloudAuthProvider>
									<SettingsProvider>
										<RestoredSettings>
											<BottomSheetModalProvider>
												<NavThemeProvider value={navigationTheme}>
													<StatusBar
														style={theme.mode === "dark" ? "light" : "dark"}
													/>
													{fontsReady && appearanceReady ? (
														<Stack
															screenOptions={{
																headerStyle: {
																	backgroundColor: theme.color.surface,
																},
																headerTintColor: theme.color.text,
																headerTitleStyle: {
																	color: theme.color.text,
																},
																contentStyle: {
																	backgroundColor: theme.color.canvas,
																},
															}}
														>
															<Stack.Screen
																name="index"
																options={{ headerShown: false }}
															/>
															<Stack.Screen
																name="cloud"
																options={{ headerShown: false }}
															/>
															<Stack.Protected
																guard={COMPUTER_CONNECTIONS_ENABLED}
															>
																<Stack.Screen
																	name="computers"
																	options={{ headerShown: false }}
																/>
																<Stack.Screen
																	name="handoff"
																	options={{ headerShown: false }}
																/>
																<Stack.Screen
																	name="scan"
																	options={{ headerShown: false }}
																/>
															</Stack.Protected>
															<Stack.Screen
																name="chat"
																options={{
																	headerShown: false,
																	gestureEnabled: false,
																}}
															/>
															<Stack.Screen
																name="cloud-start"
																options={{ headerShown: false }}
															/>
															<Stack.Screen
																name="settings"
																options={{ headerShown: false }}
															/>
														</Stack>
													) : (
														<StartupScreen />
													)}
												</NavThemeProvider>
											</BottomSheetModalProvider>
										</RestoredSettings>
									</SettingsProvider>
								</CloudAuthProvider>
							</LastOpenedProvider>
						</ExecutionTargetsProvider>
					</EndpointsProvider>
				</KeyboardProvider>
			</SafeAreaProvider>
		</GestureHandlerRootView>
	);
}
