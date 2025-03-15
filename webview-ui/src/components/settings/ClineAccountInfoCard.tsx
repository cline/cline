import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useFirebaseAuth } from "../../context/FirebaseAuthContext"
import { vscode } from "../../utils/vscode"

export const ClineAccountInfoCard = () => {
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

	const handleShowAccount = () => {
		vscode.postMessage({ type: "showAccountViewClicked" })
	}

	return (
		<div style={{ maxWidth: "600px" }}>
			{user ? (
				<div
					style={{
						padding: "8px 10px",
						border: "1px solid var(--vscode-input-border)",
						borderRadius: "2px",
						backgroundColor: "var(--vscode-dropdown-background)",
					}}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "8px",
						}}>
						{user.photoURL ? (
							<img
								src={user.photoURL}
								alt="Profile"
								style={{
									width: 38,
									height: 38,
									borderRadius: "50%",
								}}
							/>
						) : (
							<div
								style={{
									width: 38,
									height: 38,
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
										wordWrap: "break-word",
									}}>
									{user.displayName}
								</div>
							)}
							{user.email && (
								<div
									style={{
										fontSize: "13px",
										color: "var(--vscode-descriptionForeground)",
										wordWrap: "break-word",
										overflow: "hidden",
										textOverflow: "ellipsis",
										maxWidth: "100%",
									}}>
									{user.email}
								</div>
							)}
							<div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
								<VSCodeButton
									appearance="primary"
									onClick={handleShowAccount}
									style={{
										transform: "scale(0.85)",
										transformOrigin: "left center",
										width: "fit-content",
										marginTop: 2,
										marginBottom: 0,
										marginRight: -12,
									}}>
									Account
								</VSCodeButton>
								<VSCodeButton
									appearance="secondary"
									onClick={handleLogout}
									style={{
										transform: "scale(0.85)",
										transformOrigin: "left center",
										width: "fit-content",
										marginTop: 2,
										marginBottom: 0,
										marginRight: -12,
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
