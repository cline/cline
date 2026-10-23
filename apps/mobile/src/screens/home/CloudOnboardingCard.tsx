import {
	ArrowRight,
	Check,
	Cloud,
	GitBranch,
	LogIn,
	RefreshCw,
	Sparkles,
} from "lucide-react-native";
import Svg, { Path } from "react-native-svg";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { Button, Card, Text, useTheme } from "@/ui";

type CloudOnboardingVariant =
	| "signed_out"
	| "not_connected"
	| "no_repositories"
	| "error";

// Native counterpart of Desktop's views/chat/cloud-onboarding.tsx.
export function CloudOnboardingCard({
	variant,
	checking = false,
	signingIn = false,
	onConnect,
	onRefresh,
	onSignIn,
	progress,
}: {
	variant: CloudOnboardingVariant;
	checking?: boolean;
	signingIn?: boolean;
	onConnect?: () => void;
	onRefresh: () => void;
	onSignIn?: () => void;
	progress?: ReactNode;
}) {
	const theme = useTheme();
	const wide = useWindowDimensions().width >= 600;
	if (variant === "error")
		return (
			<Card padding={16} style={{ gap: 8 }}>
				<Text variant="body" weight="500">
					Could not reach Cline Cloud
				</Text>
				<Text variant="small" tone="muted">
					Check your connection and try again.
				</Text>
				<Button
					label="Retry"
					variant="outline"
					loading={checking}
					onPress={onRefresh}
					icon={<RefreshCw size={15} color={theme.color.text} />}
				/>
				{progress}
			</Card>
		);
	const signedOut = variant === "signed_out";
	const noRepositories = variant === "no_repositories";
	const steps = [
		{
			title: signedOut ? "Sign in with Cline" : "Connect GitHub",
			description: signedOut
				? "Cloud sessions are part of your Cline account."
				: "Link your GitHub account from the Cline dashboard.",
			done: noRepositories,
		},
		{
			title: "Pick your repositories",
			description: "Choose which repositories the Cline GitHub App can access.",
			active: noRepositories,
		},
		{
			title: "Start a session",
			description:
				"Pick a repo and branch, describe the task, and Cline gets to work.",
		},
	];
	return (
		<Card padding={16} style={{ gap: 16 }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 8,
				}}
			>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: 5,
						borderRadius: theme.radius.pill,
						paddingHorizontal: 8,
						paddingVertical: 5,
						backgroundColor: theme.brand.violetSubtle,
					}}
				>
					<Sparkles size={12} color={theme.brand.violet} />
					<Text variant="caption" tone="accent" weight="500">
						CLOUD SESSIONS
					</Text>
				</View>
				<View
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
				>
					<Github size={18} color={theme.color.textMuted} />
					<ArrowRight size={12} color={theme.color.textMuted} />
					<View
						style={{
							padding: 7,
							borderRadius: theme.radius.md,
							backgroundColor: theme.brand.violetSubtle,
							borderWidth: 1,
							borderColor: theme.brand.violetRing,
						}}
					>
						<Cloud size={21} color={theme.brand.violet} />
					</View>
					<ArrowRight size={12} color={theme.color.textMuted} />
					<GitBranch size={18} color={theme.color.textMuted} />
				</View>
			</View>
			<View style={{ gap: 6 }}>
				<Text variant="heading" accessibilityRole="header">
					{signedOut
						? "Run Cline in the cloud"
						: noRepositories
							? "Give Cline access to a repository"
							: "Connect GitHub to get started"}
				</Text>
				<Text variant="small" tone="muted">
					Cloud sessions run on secure, isolated sandboxes on Cline's
					infrastructure. Cline clones your repository, works on a branch, and
					keeps going even when you close the app — check back in from any
					device.
				</Text>
			</View>
			<View style={{ flexDirection: wide ? "row" : "column", gap: 8 }}>
				{steps.map((step, index) => (
					<View
						key={step.title}
						style={{
							flex: wide ? 1 : undefined,
							flexDirection: "row",
							alignItems: "flex-start",
							gap: 8,
							padding: 10,
							borderRadius: theme.radius.md,
							borderWidth: 1,
							borderColor: step.active
								? theme.brand.violetBorder
								: theme.color.border,
							backgroundColor: step.active
								? theme.brand.violetSubtle
								: theme.color.canvas,
						}}
					>
						<View
							style={{
								width: 22,
								height: 22,
								borderRadius: 11,
								alignItems: "center",
								justifyContent: "center",
								backgroundColor: step.active
									? theme.brand.primary
									: theme.color.surfaceMuted,
							}}
						>
							{step.done ? (
								<Check size={13} color={theme.feedback.success.fg} />
							) : (
								<Text
									variant="caption"
									color={
										step.active ? theme.brand.onPrimary : theme.color.textMuted
									}
								>
									{index + 1}
								</Text>
							)}
						</View>
						<View style={{ flex: 1, gap: 3 }}>
							<Text variant="small" weight="500">
								{step.title}
							</Text>
							<Text variant="caption" tone="muted">
								{step.description}
							</Text>
						</View>
					</View>
				))}
			</View>
			<View style={{ flexDirection: wide ? "row" : "column", gap: 4 }}>
				{signedOut ? (
					<Button
						label="Sign in with Cline"
						accessibilityLabel="Sign in to Cline"
						loading={signingIn}
						loadingLabel="Waiting for browser…"
						onPress={onSignIn}
						fullWidth={!wide}
						icon={<LogIn size={15} color={theme.brand.onPrimary} />}
					/>
				) : (
					<>
						<Button
							label={
								noRepositories ? "Manage repository access" : "Connect GitHub"
							}
							onPress={onConnect}
							fullWidth={!wide}
							icon={<Github size={15} color={theme.brand.onPrimary} />}
						/>
						<Button
							label={noRepositories ? "Check again" : "I've connected GitHub"}
							variant="ghost"
							loading={checking}
							onPress={onRefresh}
							fullWidth={!wide}
							icon={<RefreshCw size={15} color={theme.color.textMuted} />}
						/>
					</>
				)}
			</View>
			{progress}
		</Card>
	);
}

// GitHub mark from Desktop's Lucide icon (ISC); native Lucide omits brand icons.
function Github({ size, color }: { size: number; color: string }) {
	return (
		<Svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke={color}
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<Path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
			<Path d="M9 18c-4.51 2-5-2-7-2" />
		</Svg>
	);
}
