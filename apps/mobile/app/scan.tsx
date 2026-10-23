import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { ChevronLeft, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { AppState, Linking, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PairComputerState } from "@/screens/home/PairComputerState";
import { isHandoffUrl } from "@/state/handoff-link";
import { Button, IconButton, ScreenHeader, Text, useTheme } from "@/ui";

type ScanStep = "instructions" | "permission" | "scanner";

export default function ScanHandoffRoute() {
	const router = useRouter();
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const [permission, requestPermission, getPermission] = useCameraPermissions();
	const [step, setStep] = useState<ScanStep>("instructions");
	const [error, setError] = useState<string>();
	const handled = useRef(false);

	useEffect(() => {
		if (step !== "permission" || permission?.canAskAgain !== false) return;
		const subscription = AppState.addEventListener("change", (nextState) => {
			if (nextState !== "active") return;
			void getPermission()
				.then((next) => {
					if (next.granted) setStep("scanner");
				})
				.catch(() => {});
		});
		return () => subscription.remove();
	}, [getPermission, permission?.canAskAgain, step]);

	const openScanner = async () => {
		if (permission?.granted) {
			setStep("scanner");
			return;
		}
		if (permission?.canAskAgain === false) {
			setStep("permission");
			return;
		}
		const next = await requestPermission();
		setStep(next.granted ? "scanner" : "permission");
	};

	if (step === "instructions") {
		return (
			<View
				style={{
					flex: 1,
					paddingTop: insets.top,
					paddingLeft: insets.left,
					paddingRight: insets.right,
					paddingBottom: insets.bottom,
					backgroundColor: theme.color.canvas,
				}}
			>
				<ScreenHeader
					title="Connect a computer"
					leading={
						<IconButton
							accessibilityLabel="Back to sessions"
							onPress={() => router.back()}
						>
							<ChevronLeft size={20} color={theme.color.text} />
						</IconButton>
					}
				/>
				<ScrollView
					contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
				>
					<PairComputerState onPair={() => void openScanner()} />
				</ScrollView>
			</View>
		);
	}
	if (step === "permission" || !permission?.granted) {
		return (
			<ScrollView
				style={{ flex: 1, backgroundColor: theme.color.canvas }}
				contentContainerStyle={{
					flexGrow: 1,
					justifyContent: "center",
					paddingTop: insets.top + 24,
					paddingBottom: insets.bottom + 24,
					paddingLeft: insets.left + 24,
					paddingRight: insets.right + 24,
					gap: 12,
					backgroundColor: theme.color.canvas,
				}}
			>
				<Text variant="heading">Scan your computer</Text>
				<Text variant="body" tone="muted">
					Camera access is used only to read the one-time QR shown by /handoff.
				</Text>
				{permission?.canAskAgain !== false ? (
					<Button
						label="Allow camera"
						fullWidth
						onPress={() => void openScanner()}
					/>
				) : (
					<Button
						label="Open Settings"
						fullWidth
						onPress={() => void Linking.openSettings()}
					/>
				)}
				<Button
					label="How to create the QR code"
					variant="ghost"
					fullWidth
					onPress={() => setStep("instructions")}
				/>
			</ScrollView>
		);
	}

	return (
		<View style={{ flex: 1, backgroundColor: "#000" }}>
			<CameraView
				style={{ flex: 1 }}
				barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
				onBarcodeScanned={({ data }) => {
					if (handled.current) return;
					if (!isHandoffUrl(data)) {
						setError("That is not a Cline handoff QR code.");
						return;
					}
					handled.current = true;
					const query = data.split("?")[1] ?? "";
					const params = Object.fromEntries(new URLSearchParams(query));
					router.replace({ pathname: "/handoff", params });
				}}
			/>
			<View
				style={{
					position: "absolute",
					top: insets.top + 12,
					left: insets.left + 16,
					right: insets.right + 16,
					flexDirection: "row",
					alignItems: "center",
					gap: 12,
				}}
			>
				<IconButton
					accessibilityLabel="Close scanner"
					onPress={() => {
						handled.current = false;
						setError(undefined);
						setStep("instructions");
					}}
				>
					<X size={20} color="#fff" />
				</IconButton>
				<Text variant="heading" color="#fff">
					Scan /handoff QR
				</Text>
			</View>
			<View
				style={{
					position: "absolute",
					left: insets.left + 24,
					right: insets.right + 24,
					bottom: insets.bottom + 24,
					padding: 14,
					borderRadius: 12,
					backgroundColor: "rgba(0,0,0,0.72)",
				}}
			>
				<Text variant="body" color="#fff" style={{ textAlign: "center" }}>
					{error ??
						"Point your camera at the QR shown in Cline on your computer."}
				</Text>
			</View>
		</View>
	);
}
