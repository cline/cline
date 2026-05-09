import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react"
import type { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface ProfileManagerProps {
	currentMode: Mode
	onStartAdd: () => void
	onStartEdit: (profileId: string) => void
	onDelete: (profileId: string) => void
}

const ProfileManager = ({ currentMode, onStartAdd, onStartEdit, onDelete }: ProfileManagerProps) => {
	const { apiConfigProfiles, lastAppliedProfileIdByMode } = useExtensionState()
	const byMode = lastAppliedProfileIdByMode ?? { plan: undefined, act: undefined }
	return (
		<div className="mb-6">
			<div className="flex items-center justify-between mb-2">
				{/* <span className="font-medium text-sm">Saved Configurations</span> */}
				<VSCodeButton appearance="secondary" onClick={onStartAdd}>
					+ Add
				</VSCodeButton>
			</div>

			{apiConfigProfiles.length === 0 ? (
				<p className="text-xs text-(--vscode-descriptionForeground)">
					No saved configurations yet.
				</p>
			) : (
				<div className="flex flex-col gap-2">
					{apiConfigProfiles.map((profile) => {
						const isActive = profile.id === byMode[currentMode]
						return (
							<div
								key={profile.id}
								className="w-full flex items-center gap-1 px-2 py-1.5 rounded-xs border cursor-pointer group"
								style={{
									borderColor: "var(--vscode-textLink-foreground)",
									opacity: isActive ? 1 : 0.6,
									backgroundColor: isActive ? "var(--vscode-list-hoverBackground)" : "transparent",
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.opacity = "1"
									if (!isActive) e.currentTarget.style.backgroundColor = "var(--vscode-list-hoverBackground)"
								}}
								onMouseLeave={(e) => {
									if (!isActive) {
										e.currentTarget.style.opacity = "0.6"
										e.currentTarget.style.backgroundColor = "transparent"
									}
								}}>
								<div className="flex-1 min-w-0 flex items-center gap-1">
									 <span className="text-(--vscode-terminal-ansiBlue) text-sm shrink-0" style={{ opacity: isActive ? 1 : 0 }}>
      ●
    </span>
									<span className="text-xs truncate">{profile.modelId ? `${profile.provider}:${profile.modelId}` : profile.provider}</span>
								</div>
								<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
									<VSCodeButton
										appearance="icon"
										title="Edit profile"
										onClick={() => onStartEdit(profile.id)}>
										Edit
									</VSCodeButton>
									<VSCodeButton
										appearance="icon"
										title="Delete profile"
										onClick={() => onDelete(profile.id)}>
										Delete
									</VSCodeButton>
								</div>
							</div>
						)
					})}
				</div>
			)}
			<VSCodeDivider className="my-3" />
		</div>
	)
}

export default ProfileManager
