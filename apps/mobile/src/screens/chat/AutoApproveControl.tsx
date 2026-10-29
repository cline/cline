/**
 * Policy pill and sheet shared by Home and chat. Callers write the policy store;
 * app/chat.tsx forwards policy changes to the live connection.
 */

import type GorhomBottomSheet from "@gorhom/bottom-sheet";
import { ChevronUp, ShieldCheck, TriangleAlert } from "lucide-react-native";
import { type RefObject, useRef } from "react";
import { Pressable, View } from "react-native";
import {
	ApprovalTierRow,
	matchesPreset,
	POLICY_PRESETS,
	type PolicyPreset,
	summarizeApprovalPolicy,
} from "@/screens/approval";
import {
	APPROVAL_TIERS,
	type ApprovalPolicy,
	type ApprovalTier,
	type ApprovalTierSetting,
} from "@/session";
import { BottomSheet, borderAlpha, Divider, Text, useTheme } from "@/ui";
import { ComposerPill, usePillColors } from "./ComposerPill";

export interface AutoApprovePillProps {
	policy: ApprovalPolicy;
	onPress(): void;
}

export function AutoApprovePill({ policy, onPress }: AutoApprovePillProps) {
	const summary = summarizeApprovalPolicy(policy);
	const colors = usePillColors(summary.tone);
	const Icon = summary.tone === "danger" ? TriangleAlert : ShieldCheck;
	return (
		<ComposerPill
			label={summary.label}
			tone={summary.tone}
			leading={<Icon size={12} color={colors.text} />}
			trailing={<ChevronUp size={12} color={colors.text} />}
			accessibilityLabel={`Auto-approve: ${summary.spoken}`}
			accessibilityHint="Opens the auto-approve controls"
			onPress={onPress}
		/>
	);
}

export interface AutoApproveSheetProps {
	policy: ApprovalPolicy;
	onSetTier(tier: ApprovalTier, value: ApprovalTierSetting): void;
	onSetPolicy(policy: ApprovalPolicy): void;
	sheetRef?: RefObject<GorhomBottomSheet | null>;
}

export function AutoApproveSheet({
	policy,
	onSetTier,
	onSetPolicy,
	sheetRef: externalRef,
}: AutoApproveSheetProps) {
	const internalRef = useRef<GorhomBottomSheet>(null);
	const sheetRef = externalRef ?? internalRef;
	const summary = summarizeApprovalPolicy(policy);

	return (
		<BottomSheet
			ref={sheetRef}
			index={-1}
			enableDynamicSizing
			enablePanDownToClose
			scrollable
		>
			<View style={{ gap: 4 }}>
				<Text variant="body" weight="500">
					Auto-approve
				</Text>
				<Text variant="small" tone="muted">
					Right now: {summary.spoken}. Changes apply to this session
					immediately.
				</Text>

				<View style={{ paddingTop: 8 }}>
					{APPROVAL_TIERS.map((tier, index) => (
						<View key={tier}>
							{index > 0 ? <Divider alpha={borderAlpha.strong} /> : null}
							<ApprovalTierRow
								tier={tier}
								variant="plain"
								value={policy[tier] === "auto"}
								onChange={(next) => onSetTier(tier, next ? "auto" : "ask")}
							/>
						</View>
					))}
				</View>

				<Divider alpha={borderAlpha.strong} />
				<Text
					variant="caption"
					tone="muted"
					weight="500"
					style={{ paddingTop: 8 }}
				>
					Presets
				</Text>
				<View style={{ gap: 8, paddingTop: 4 }}>
					{POLICY_PRESETS.map((preset) => (
						<PresetRow
							key={preset.id}
							preset={preset}
							active={matchesPreset(policy, preset)}
							onPress={() => onSetPolicy(preset.policy)}
						/>
					))}
				</View>

				<Text variant="caption" tone="muted" style={{ paddingTop: 8 }}>
					Tools Cline does not recognise — including MCP tools and anything that
					reaches the network — use your “Run commands” setting.
				</Text>
				<View style={{ height: 8 }} />
			</View>
		</BottomSheet>
	);
}

/** Highlight presets that allow commands to run without approval. */
function PresetRow({
	preset,
	active,
	onPress,
}: {
	preset: PolicyPreset;
	active: boolean;
	onPress: () => void;
}) {
	const theme = useTheme();
	const danger = preset.danger === true;
	const border = danger
		? theme.feedback.danger.border
		: active
			? theme.brand.violetBorder
			: theme.color.border;
	const fill = danger
		? theme.feedback.danger.subtle
		: active
			? theme.brand.violetSubtle
			: theme.color.canvas;

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={preset.label}
			accessibilityHint={preset.description}
			accessibilityState={{ selected: active }}
			onPress={onPress}
			style={({ pressed }) => ({
				gap: 2,
				padding: 12,
				minHeight: 44,
				justifyContent: "center",
				borderRadius: theme.radius.md,
				borderWidth: 1,
				borderColor: border,
				backgroundColor: fill,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
				{danger ? (
					<TriangleAlert size={13} color={theme.feedback.danger.fg} />
				) : null}
				<Text
					variant="small"
					weight="500"
					tone={danger ? "danger" : active ? "accent" : "default"}
				>
					{preset.label}
					{active ? " · current" : ""}
				</Text>
			</View>
			<Text variant="caption" tone={danger ? "danger" : "muted"}>
				{preset.description}
			</Text>
		</Pressable>
	);
}
