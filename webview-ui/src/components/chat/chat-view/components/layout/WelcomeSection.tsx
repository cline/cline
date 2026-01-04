import { BANNER_DATA, BannerAction, BannerActionType, BannerCardData } from "@shared/cline/banner"
import type { Worktree } from "@shared/proto/cline/worktree"
import { EmptyRequest, Int64Request } from "@shared/proto/index.cline"
import { GitBranch } from "lucide-react"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import BannerCarousel from "@/components/common/BannerCarousel"
import WhatsNewModal from "@/components/common/WhatsNewModal"
import HistoryPreview from "@/components/history/HistoryPreview"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import HomeHeader from "@/components/welcome/HomeHeader"
import { SuggestedTasks } from "@/components/welcome/SuggestedTasks"
import CreateWorktreeModal from "@/components/worktrees/CreateWorktreeModal"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient, StateServiceClient, WorktreeServiceClient } from "@/services/grpc-client"
import { convertBannerData } from "@/utils/bannerUtils"
import { getCurrentPlatform } from "@/utils/platformUtils"
import { WelcomeSectionProps } from "../../types/chatTypes"

const CURRENT_INFO_BANNER_VERSION = 1
const CURRENT_MODEL_BANNER_VERSION = 1
const CURRENT_CLI_BANNER_VERSION = 1

/**
 * Welcome section shown when there's no active task
 * Includes info banner, announcements, home header, and history preview
 */
export const WelcomeSection: React.FC<WelcomeSectionProps> = ({
	showAnnouncement,
	hideAnnouncement,
	showHistoryView,
	version,
	taskHistory,
	shouldShowQuickWins,
}) => {
	const { lastDismissedInfoBannerVersion, lastDismissedCliBannerVersion, lastDismissedModelBannerVersion } = useExtensionState()

	// Track if we've shown the "What's New" modal this session
	const [hasShownWhatsNewModal, setHasShownWhatsNewModal] = useState(false)
	const [showWhatsNewModal, setShowWhatsNewModal] = useState(false)

	// Quick launch worktree modal
	const [showCreateWorktreeModal, setShowCreateWorktreeModal] = useState(false)
	const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null)
	const [currentWorktree, setCurrentWorktree] = useState<Worktree | null>(null)

	// Check if we're in a git repo and get current worktree info on mount
	useEffect(() => {
		WorktreeServiceClient.listWorktrees(EmptyRequest.create({}))
			.then((result) => {
				const canUseWorktrees = result.isGitRepo && !result.isMultiRoot && !result.isSubfolder
				setIsGitRepo(canUseWorktrees)
				if (canUseWorktrees) {
					const current = result.worktrees.find((w) => w.isCurrent)
					setCurrentWorktree(current || null)
				}
			})
			.catch(() => setIsGitRepo(false))
	}, [])

	const { clineUser } = useClineAuth()
	const { openRouterModels, setShowChatModelSelector, navigateToSettings, navigateToWorktrees, subagentsEnabled } =
		useExtensionState()
	const { handleFieldsChange } = useApiConfigurationHandlers()

	// Show modal when there's a new announcement and we haven't shown it this session
	useEffect(() => {
		if (showAnnouncement && !hasShownWhatsNewModal) {
			setShowWhatsNewModal(true)
			setHasShownWhatsNewModal(true)
		}
	}, [showAnnouncement, hasShownWhatsNewModal])

	const handleCloseWhatsNewModal = useCallback(() => {
		setShowWhatsNewModal(false)
		// Call hideAnnouncement to persist dismissal (same as old banner behavior)
		hideAnnouncement()
	}, [hideAnnouncement])

	/**
	 * Check if a banner has been dismissed based on its version
	 */
	const isBannerDismissed = useCallback(
		(bannerId: string): boolean => {
			if (bannerId.startsWith("info-banner")) {
				return (lastDismissedInfoBannerVersion ?? 0) >= CURRENT_INFO_BANNER_VERSION
			}
			if (bannerId.startsWith("new-model")) {
				return (lastDismissedModelBannerVersion ?? 0) >= CURRENT_MODEL_BANNER_VERSION
			}
			if (bannerId.startsWith("cli-")) {
				return (lastDismissedCliBannerVersion ?? 0) >= CURRENT_CLI_BANNER_VERSION
			}
			return false
		},
		[lastDismissedInfoBannerVersion, lastDismissedModelBannerVersion, lastDismissedCliBannerVersion],
	)

	/**
	 * Banner configuration from backend
	 * In production, this would come from an API/gRPC call
	 * For now, using EXAMPLE_BANNER_DATA with version-based filtering
	 */
	const bannerConfig = useMemo((): BannerCardData[] => {
		// Filter banners based on version tracking and user status
		return BANNER_DATA.filter((banner) => {
			if (isBannerDismissed(banner.id)) {
				return false
			}

			if (banner.isClineUserOnly !== undefined) {
				return banner.isClineUserOnly === !!clineUser
			}

			if (banner.platforms && !banner.platforms.includes(getCurrentPlatform())) {
				return false
			}

			return true
		})
	}, [isBannerDismissed, clineUser])

	/**
	 * Action handler - maps action types to actual implementations
	 */
	const handleBannerAction = useCallback(
		(action: BannerAction) => {
			switch (action.action) {
				case BannerActionType.Link:
					// Links are handled by VSCodeLink component
					break

				case BannerActionType.SetModel: {
					const modelId = action.arg || "anthropic/claude-opus-4.5"
					handleFieldsChange({
						planModeOpenRouterModelId: modelId,
						actModeOpenRouterModelId: modelId,
						planModeOpenRouterModelInfo: openRouterModels[modelId],
						actModeOpenRouterModelInfo: openRouterModels[modelId],
						planModeApiProvider: "cline",
						actModeApiProvider: "cline",
					})
					setTimeout(() => setShowChatModelSelector(true), 10)
					break
				}

				case BannerActionType.ShowAccount:
					AccountServiceClient.accountLoginClicked(EmptyRequest.create()).catch((err) =>
						console.error("Failed to get login URL:", err),
					)
					break

				case BannerActionType.ShowApiSettings:
					navigateToSettings("api")
					break

				case BannerActionType.ShowFeatureSettings:
					navigateToSettings("features")
					break

				case BannerActionType.InstallCli:
					StateServiceClient.installClineCli(EmptyRequest.create()).catch((error) =>
						console.error("Failed to initiate CLI installation:", error),
					)
					break

				default:
					console.warn("Unknown banner action:", action.action)
			}
		},
		[handleFieldsChange, openRouterModels, setShowChatModelSelector, navigateToSettings],
	)

	/**
	 * Dismissal handler - updates version tracking
	 */
	const handleBannerDismiss = useCallback((bannerId: string) => {
		// Map banner IDs to version updates
		if (bannerId.startsWith("info-banner")) {
			StateServiceClient.updateInfoBannerVersion({ value: CURRENT_INFO_BANNER_VERSION }).catch(console.error)
		} else if (bannerId.startsWith("new-model")) {
			StateServiceClient.updateModelBannerVersion(Int64Request.create({ value: CURRENT_MODEL_BANNER_VERSION })).catch(
				console.error,
			)
		} else if (bannerId.startsWith("cli-")) {
			StateServiceClient.updateCliBannerVersion(Int64Request.create({ value: CURRENT_CLI_BANNER_VERSION })).catch(
				console.error,
			)
		}
	}, [])

	/**
	 * Build array of active banners for carousel
	 */
	const activeBanners = useMemo(() => {
		// Convert to BannerData format for carousel
		return bannerConfig.map((banner) =>
			convertBannerData(banner, {
				onAction: handleBannerAction,
				onDismiss: handleBannerDismiss,
			}),
		)
	}, [bannerConfig, clineUser, subagentsEnabled, handleBannerAction, handleBannerDismiss])

	return (
		<div className="flex flex-col flex-1 w-full h-full p-0 m-0">
			<WhatsNewModal onClose={handleCloseWhatsNewModal} open={showWhatsNewModal} version={version} />
			<div className="overflow-y-auto flex flex-col pb-2.5">
				<HomeHeader shouldShowQuickWins={shouldShowQuickWins} />
				{!showWhatsNewModal && (
					<>
						<BannerCarousel banners={activeBanners} />
						{!shouldShowQuickWins && taskHistory.length > 0 && <HistoryPreview showHistoryView={showHistoryView} />}
						{/* Quick launch worktree button */}
						{isGitRepo && (
							<div className="flex flex-col items-center gap-3 mt-4 mb-4 px-5">
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											className="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--vscode-foreground)]/30 text-[var(--vscode-foreground)] bg-transparent hover:bg-[var(--vscode-list-hoverBackground)] active:opacity-80 text-sm font-medium cursor-pointer"
											onClick={() => setShowCreateWorktreeModal(true)}
											type="button">
											<span className="codicon codicon-empty-window"></span>
											New Worktree Window
										</button>
									</TooltipTrigger>
									<TooltipContent side="top">
										Create a new git worktree and open it in a separate window. Great for running parallel
										Cline tasks.
									</TooltipContent>
								</Tooltip>
								{currentWorktree && (
									<button
										className="flex flex-col items-center gap-0.5 text-xs text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] cursor-pointer bg-transparent border-none p-1 rounded"
										onClick={navigateToWorktrees}
										type="button">
										<div className="flex items-center gap-1.5 text-xs">
											<GitBranch className="w-3 h-3 stroke-[2.5] flex-shrink-0" />
											<span className="break-all text-center">
												<span className="font-semibold">Current:</span>{" "}
												{currentWorktree.branch || "detached HEAD"}
											</span>
										</div>
										<span className="break-all text-center max-w-[300px]">{currentWorktree.path}</span>
									</button>
								)}
							</div>
						)}
					</>
				)}
			</div>
			<SuggestedTasks shouldShowQuickWins={shouldShowQuickWins} />

			{/* Quick launch worktree modal */}
			<CreateWorktreeModal
				onClose={() => setShowCreateWorktreeModal(false)}
				open={showCreateWorktreeModal}
				openAfterCreate={true}
			/>
		</div>
	)
}
