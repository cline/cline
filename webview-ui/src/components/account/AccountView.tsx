import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import type { CloudUserInfo } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

type AccountViewProps = {
	userInfo: CloudUserInfo | null
	isAuthenticated: boolean
	onDone: () => void
}

export const AccountView = ({ userInfo, isAuthenticated, onDone }: AccountViewProps) => {
	const { t } = useAppTranslation()

	const rooLogoUri = (window as any).IMAGES_BASE_URI + "/roo-logo.svg"

	return (
		<div className="flex flex-col h-full p-4 bg-vscode-editor-background">
			<div className="flex justify-between items-center mb-6">
				<h1 className="text-xl font-medium text-vscode-foreground">{t("account:title")}</h1>
				<VSCodeButton appearance="primary" onClick={onDone}>
					{t("settings:common.done")}
				</VSCodeButton>
			</div>
			{isAuthenticated ? (
				<>
					{userInfo && (
						<div className="flex flex-col items-center mb-6">
							<div className="w-16 h-16 mb-3 rounded-full overflow-hidden">
								{userInfo?.picture ? (
									<img
										src={userInfo.picture}
										alt={t("account:profilePicture")}
										className="w-full h-full object-cover"
									/>
								) : (
									<div className="w-full h-full flex items-center justify-center bg-vscode-button-background text-vscode-button-foreground text-xl">
										{userInfo?.name?.charAt(0) || userInfo?.email?.charAt(0) || "?"}
									</div>
								)}
							</div>
							<h2 className="text-lg font-medium text-vscode-foreground mb-1">
								{userInfo?.name || t("account:unknownUser")}
							</h2>
							<p className="text-sm text-vscode-descriptionForeground">{userInfo?.email || ""}</p>
						</div>
					)}
					<div className="flex flex-col gap-2 mt-4">
						<VSCodeButton
							appearance="secondary"
							onClick={() => vscode.postMessage({ type: "rooCloudSignOut" })}
							className="w-full">
							{t("account:logOut")}
						</VSCodeButton>
					</div>
				</>
			) : (
				<>
					<div className="flex flex-col items-center mb-4 text-center">
						<div className="w-16 h-16 mb-4 flex items-center justify-center">
							<div
								className="w-12 h-12 bg-vscode-foreground"
								style={{
									WebkitMaskImage: `url('${rooLogoUri}')`,
									WebkitMaskRepeat: "no-repeat",
									WebkitMaskSize: "contain",
									maskImage: `url('${rooLogoUri}')`,
									maskRepeat: "no-repeat",
									maskSize: "contain",
								}}>
								<img src={rooLogoUri} alt="Roo logo" className="w-12 h-12 opacity-0" />
							</div>
						</div>
					</div>
					<div className="flex flex-col gap-4">
						<VSCodeButton
							appearance="primary"
							onClick={() => vscode.postMessage({ type: "rooCloudSignIn" })}
							className="w-full">
							{t("account:signIn")}
						</VSCodeButton>
					</div>
				</>
			)}
		</div>
	)
}
