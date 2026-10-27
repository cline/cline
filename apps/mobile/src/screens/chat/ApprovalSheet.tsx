/**
 * Shows unresolved approvals, including automatic approvals that failed.
 * SessionConnection applies the policy and removes approvals after a successful response.
 */

import type { PendingApprovalInfo } from "@cline/shared";
import type GorhomBottomSheet from "@gorhom/bottom-sheet";
import { Clock3, ShieldAlert } from "lucide-react-native";
import { type RefObject, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import {
	BottomSheet,
	Button,
	borderAlpha,
	Divider,
	expandBottomSheetAfterKeyboardDismiss,
	Text,
	TextField,
	useTheme,
} from "@/ui";

export interface ApprovalSheetProps {
	connectionKind?: "local" | "cloud";
	approvals: PendingApprovalInfo[];
	onRespond(
		approvalId: string,
		approved: boolean,
		reason?: string,
	): Promise<void>;
	/** External handle so a banner can re-open a dismissed sheet. */
	sheetRef?: RefObject<GorhomBottomSheet | null>;
}

export function ApprovalSheet({
	connectionKind = "local",
	approvals,
	onRespond,
	sheetRef: externalRef,
}: ApprovalSheetProps) {
	const theme = useTheme();
	const internalRef = useRef<GorhomBottomSheet>(null);
	const sheetRef = externalRef ?? internalRef;
	const hasApprovals = approvals.length > 0;

	useEffect(() => {
		if (hasApprovals) {
			expandBottomSheetAfterKeyboardDismiss(sheetRef);
		} else {
			sheetRef.current?.close();
		}
	}, [hasApprovals, sheetRef]);

	return (
		<BottomSheet
			ref={sheetRef}
			index={hasApprovals ? 0 : -1}
			enableDynamicSizing
			enablePanDownToClose
			scrollable
		>
			<View style={{ gap: 12 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<ShieldAlert size={16} color={theme.feedback.warning.fg} />
					<Text variant="body" weight="500">
						Tool approval required
					</Text>
				</View>
				<Text variant="small" tone="muted">
					{connectionKind === "cloud"
						? "Review what Cline wants to run in this Cloud workspace, then approve or deny the request."
						: "Review what Cline wants to run. Tiers set to auto-approve run without asking. Change Auto-approve below the message box."}
				</Text>
				{approvals.map((approval, index) => (
					<View key={approval.approvalId} style={{ gap: 8 }}>
						{index > 0 ? <Divider alpha={borderAlpha.strong} /> : null}
						<ApprovalCard approval={approval} onRespond={onRespond} />
					</View>
				))}
			</View>
		</BottomSheet>
	);
}

function ApprovalCard({
	approval,
	onRespond,
}: {
	approval: PendingApprovalInfo;
	onRespond: (id: string, approved: boolean, reason?: string) => Promise<void>;
}) {
	const theme = useTheme();
	const [showReason, setShowReason] = useState(false);
	const [reason, setReason] = useState("");
	const [pending, setPending] = useState<"approve" | "deny" | undefined>();
	const [error, setError] = useState<string>();

	const respond = async (
		approved: boolean,
		nextPending: "approve" | "deny",
		nextReason?: string,
	) => {
		setPending(nextPending);
		setError(undefined);
		try {
			await onRespond(approval.approvalId, approved, nextReason);
		} catch {
			setError(
				"Could not send your response. Check the connection and try again.",
			);
		} finally {
			setPending(undefined);
		}
	};

	return (
		<View
			style={{
				borderWidth: 1,
				borderColor: theme.color.border,
				borderRadius: theme.radius.md,
				backgroundColor: theme.color.canvas,
				padding: 12,
				gap: 8,
			}}
		>
			<View
				style={{
					flexDirection: "row",
					justifyContent: "space-between",
					alignItems: "center",
				}}
			>
				<Text variant="body" weight="500">
					{approval.toolName}
				</Text>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
					<Clock3 size={12} color={theme.color.textMuted} />
					<Text variant="caption" tone="muted">
						{formatTime(approval.createdAt)}
					</Text>
				</View>
			</View>
			<Text variant="caption" tone="muted">
				Request {approval.approvalId} · Iteration {approval.iteration}
			</Text>
			<View
				style={{
					borderWidth: 1,
					borderColor: theme.color.border,
					borderRadius: theme.radius.sm,
					backgroundColor: theme.color.surfaceMuted,
					padding: 8,
				}}
			>
				<Text variant="mono" tone="muted" style={{ lineHeight: 18 }}>
					{formatInput(approval.inputJson)}
				</Text>
			</View>
			{showReason ? (
				<TextField
					inBottomSheet
					placeholder="Reason (optional)"
					value={reason}
					onChangeText={setReason}
					accessibilityLabel="Denial reason"
				/>
			) : null}
			{error ? (
				<Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
					{error}
				</Text>
			) : null}
			<View style={{ flexDirection: "row", gap: 8 }}>
				<Button
					label="Approve"
					variant="primary"
					loading={pending === "approve"}
					loadingLabel="Approving…"
					disabled={pending !== undefined}
					onPress={() => void respond(true, "approve")}
				/>
				<Button
					label={showReason ? "Confirm deny" : "Deny"}
					variant="outline"
					loading={pending === "deny"}
					loadingLabel="Denying…"
					disabled={pending !== undefined}
					onPress={() => {
						if (!showReason) {
							setShowReason(true);
							return;
						}
						void respond(false, "deny", reason.trim() || undefined);
					}}
				/>
			</View>
		</View>
	);
}

function formatInput(inputJson: string): string {
	try {
		return JSON.stringify(JSON.parse(inputJson), null, 2);
	} catch {
		return inputJson;
	}
}

function formatTime(epochMs: number): string {
	try {
		return new Date(epochMs).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return "";
	}
}
