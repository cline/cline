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
		<div className="max-w-[600px]">
			{user ? (
				<VSCodeButton appearance="secondary" onClick={handleShowAccount}>
					View Billing & Usage
				</VSCodeButton>
			) : (
				// <div className="p-2 rounded-[2px] bg-[var(--vscode-dropdown-background)]">
				// 	<div className="flex items-center gap-3">
				// 		{user.photoURL ? (
				// 			<img src={user.photoURL} alt="Profile" className="w-[38px] h-[38px] rounded-full flex-shrink-0" />
				// 		) : (
				// 			<div className="w-[38px] h-[38px] rounded-full bg-[var(--vscode-button-background)] flex items-center justify-center text-xl text-[var(--vscode-button-foreground)] flex-shrink-0">
				// 				{user.displayName?.[0] || user.email?.[0] || "?"}
				// 			</div>
				// 		)}
				// 		<div className="flex flex-col gap-1 flex-1 overflow-hidden">
				// 			{user.displayName && (
				// 				<div className="text-[13px] font-bold text-[var(--vscode-foreground)] break-words">
				// 					{user.displayName}
				// 				</div>
				// 			)}
				// 			{user.email && (
				// 				<div className="text-[13px] text-[var(--vscode-descriptionForeground)] break-words overflow-hidden text-ellipsis">
				// 					{user.email}
				// 				</div>
				// 			)}
				// 			<div className="flex gap-2 flex-wrap mt-1">

				// 				<VSCodeButton
				// 					appearance="secondary"
				// 					onClick={handleLogout}
				// 					className="scale-[0.85] origin-left w-fit mt-0.5 mb-0 -mr-3">
				// 					Log out
				// 				</VSCodeButton>
				// 			</div>
				// 		</div>
				// 	</div>
				// </div>
				<div>
					<VSCodeButton onClick={handleLogin} className="mt-0">
						Sign Up with Cline
					</VSCodeButton>
				</div>
			)}
		</div>
	)
}
