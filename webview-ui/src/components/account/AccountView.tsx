import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"

type AccountViewProps = {
	onDone: () => void
}

const AccountView = ({ onDone }: AccountViewProps) => {
	const { isLoggedIn, userInfo } = useExtensionState()

	const handleLogin = () => {
		vscode.postMessage({ type: "accountLoginClicked" })
	}

	const handleLogout = () => {
		vscode.postMessage({ type: "accountLogoutClicked" })
	}

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
				<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>Account</h3>
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
					{isLoggedIn ? (
						<>
							{userInfo?.photoURL && (
								<img
									src={userInfo.photoURL}
									alt="Profile"
									style={{
										width: 48,
										height: 48,
										borderRadius: "50%",
										marginBottom: 10,
									}}
								/>
							)}
							<div style={{ fontSize: "14px", marginBottom: 10 }}>
								{userInfo?.displayName && <div>Name: {userInfo.displayName}</div>}
								{userInfo?.email && <div>Email: {userInfo.email}</div>}
							</div>
							<VSCodeButton onClick={handleLogout}>Log out</VSCodeButton>
						</>
					) : (
						<VSCodeButton onClick={handleLogin}>Log in to Cline</VSCodeButton>
					)}
				</div>
			</div>
		</div>
	)
}

export default memo(AccountView)
