import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import { useFirebaseAuth } from "../../context/FirebaseAuthContext"
import { vscode } from "../../utils/vscode"
import VSCodeButtonLink from "../common/VSCodeButtonLink"

type AccountViewProps = {
	onDone: () => void
}

const AccountView = ({ onDone }: AccountViewProps) => {
	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				padding: "10px 0px 0px 20px",
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "17px",
					paddingRight: 17,
				}}>
				<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>Cline Account</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>
			<div
				style={{
					flexGrow: 1,
					overflowY: "scroll",
					paddingRight: 8,
					display: "flex",
					flexDirection: "column",
				}}>
				<div style={{ marginBottom: 5 }}>
					<ClineAccountView />
				</div>
			</div>
		</div>
	)
}

export const ClineAccountView = () => {
	const { user, handleSignOut } = useFirebaseAuth()

	const handleLogin = () => {
		vscode.postMessage({ type: "accountLoginClicked" })
	}

	const handleLogout = () => {
		// First notify extension to clear API keys and state
		vscode.postMessage({ type: "accountLogoutClicked" })
		// Then sign out of Firebase
		handleSignOut()
	}
	return (
		<div style={{ maxWidth: "600px" }}>
			{user ? (
				<div
					style={{
						padding: "12px 16px",
						border: "1px solid var(--vscode-widget-border)",
						borderRadius: "6px",
						backgroundColor: "var(--vscode-editor-background)",
					}}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "16px",
						}}>
						{user.photoURL ? (
							<img
								src={user.photoURL}
								alt="Profile"
								style={{
									width: 48,
									height: 48,
									borderRadius: "50%",
								}}
							/>
						) : (
							<div
								style={{
									width: 48,
									height: 48,
									borderRadius: "50%",
									backgroundColor: "var(--vscode-button-background)",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									fontSize: "20px",
									color: "var(--vscode-button-foreground)",
								}}>
								{user.displayName?.[0] || user.email?.[0] || "?"}
							</div>
						)}
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: "4px",
							}}>
							{user.displayName && (
								<div
									style={{
										fontSize: "13px",
										fontWeight: "bold",
										color: "var(--vscode-foreground)",
									}}>
									{user.displayName}
								</div>
							)}
							{user.email && (
								<div
									style={{
										fontSize: "13px",
										color: "var(--vscode-descriptionForeground)",
									}}>
									{user.email}
								</div>
							)}
							<div style={{ display: "flex", gap: "8px" }}>
								<VSCodeButtonLink
									href="https://app.cline.bot/account"
									appearance="primary"
									style={{
										transform: "scale(0.85)",
										transformOrigin: "left center",
										width: "fit-content",
										marginTop: 2,
										marginBottom: -2,
										marginRight: -8,
									}}>
									Account
								</VSCodeButtonLink>
								<VSCodeButton
									appearance="secondary"
									onClick={handleLogout}
									style={{
										transform: "scale(0.85)",
										transformOrigin: "left center",
										width: "fit-content",
										marginTop: 2,
										marginBottom: -2,
									}}>
									Log out
								</VSCodeButton>
							</div>
						</div>
					</div>
				</div>
			) : (
				<div style={{}}>
					<VSCodeButton onClick={handleLogin} style={{ marginTop: 0 }}>
						Sign Up with Cline
					</VSCodeButton>
				</div>
			)}
		</div>
	)
}

export default memo(AccountView)
