import { VSCodeButton, VSCodeDivider, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage } from "../../../../src/shared/ExtensionMessage"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import ApiOptions from "../settings/ApiOptions"
import ClineLogoWhite from "../../assets/ClineLogoWhite"

const WelcomeView = () => {
	const { apiConfiguration } = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [showApiOptions, setShowApiOptions] = useState(false)

	const disableLetsGoButton = apiErrorMessage != null

	const handleLogin = () => {
		vscode.postMessage({ type: "accountLoginClicked" })
	}

	const handleSubmit = () => {
		vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(apiConfiguration))
	}, [apiConfiguration])

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				padding: "0 0px",
				display: "flex",
				flexDirection: "column",
			}}>
			<div
				style={{
					height: "100%",
					padding: "0 10px",
					overflow: "auto",
				}}>
				<h2>你好，我是Cline，中国人民共和国版本！</h2>
				<div style={{ display: "flex", justifyContent: "center", margin: "60px 0" }}>
					<ClineLogoWhite className="size-60" />
				</div>
				<p>
					得益于
					{
						<VSCodeLink href="https://www.anthropic.com/claude/sonnet" style={{ display: "inline" }}>
							Claude 3.7 Sonnet
						</VSCodeLink>
					}
					的突破性编码能力，我可以完成各种任务，包括创建和编辑文件、探索复杂项目、使用浏览器、执行终端命令
					<i>(当然需要您的许可)</i>。我甚至可以使用MCP创建新工具来扩展自己的能力。
				</p>

				<p style={{ color: "var(--vscode-descriptionForeground)" }}>
					注册账号即可免费开始使用，或者使用API密钥来访问Claude 3.7 Sonnet等模型。
				</p>

				<VSCodeButton appearance="primary" onClick={handleLogin} style={{ width: "100%", marginTop: 4 }}>
					免费开始使用
				</VSCodeButton>

				{!showApiOptions && (
					<VSCodeButton
						appearance="secondary"
						onClick={() => setShowApiOptions(!showApiOptions)}
						style={{ marginTop: 10, width: "100%" }}>
						使用自己的API密钥
					</VSCodeButton>
				)}

				<div style={{ marginTop: "18px" }}>
					{showApiOptions && (
						<div>
							<ApiOptions showModelOptions={false} />
							<VSCodeButton onClick={handleSubmit} disabled={disableLetsGoButton} style={{ marginTop: "3px" }}>
								开始使用
							</VSCodeButton>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

export default WelcomeView
