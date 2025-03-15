import { memo } from "react"
import { vscode } from "../../utils/vscode"

const AccountOptions = () => {
	const handleAccountClick = () => {
		vscode.postMessage({ type: "accountLoginClicked" })
	}

	// Call handleAccountClick immediately when component mounts
	handleAccountClick()

	return null // This component doesn't render anything
}

export default memo(AccountOptions)
