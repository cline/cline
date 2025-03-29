import {
	VSCodeButton,
	VSCodeCheckbox,
	VSCodeLink,
	VSCodeTextArea,
	VSCodePanels,
	VSCodePanelTab,
	VSCodePanelView,
} from "@vscode/webview-ui-toolkit/react"
import { memo, useCallback, useEffect, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration, validateModelId } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import SettingsButton from "../common/SettingsButton"
import ApiOptions from "./ApiOptions"
import { TabButton } from "../mcp/McpView"
import { useEvent } from "react-use"
import { ExtensionMessage } from "../../../../src/shared/ExtensionMessage"
const { IS_DEV } = process.env

type SettingsViewProps = {
	onDone: () => void
}

const SettingsView = ({ onDone }: SettingsViewProps) => {
	const {
		apiConfiguration,
		version,
		customInstructions,
		setCustomInstructions,
		openRouterModels,
		telemetrySetting,
		setTelemetrySetting,
		chatSettings,
		planActSeparateModelsSetting,
		setPlanActSeparateModelsSetting,
	} = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [modelIdErrorMessage, setModelIdErrorMessage] = useState<string | undefined>(undefined)
	const [pendingTabChange, setPendingTabChange] = useState<"plan" | "act" | null>(null)

	const handleSubmit = (withoutDone: boolean = false) => {
		const apiValidationResult = validateApiConfiguration(apiConfiguration)
		const modelIdValidationResult = validateModelId(apiConfiguration, openRouterModels)

		// setApiErrorMessage(apiValidationResult)
		// setModelIdErrorMessage(modelIdValidationResult)

		let apiConfigurationToSubmit = apiConfiguration
		if (!apiValidationResult && !modelIdValidationResult) {
			// vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
			// vscode.postMessage({
			// 	type: "customInstructions",
			// 	text: customInstructions,
			// })
			// vscode.postMessage({
			// 	type: "telemetrySetting",
			// 	text: telemetrySetting,
			// })
			// console.log("handleSubmit", withoutDone)
			// vscode.postMessage({
			// 	type: "separateModeSetting",
			// 	text: separateModeSetting,
			// })
		} else {
			// if the api configuration is invalid, we don't save it
			apiConfigurationToSubmit = undefined
		}

		vscode.postMessage({
			type: "updateSettings",
			planActSeparateModelsSetting,
			customInstructionsSetting: customInstructions,
			telemetrySetting,
			apiConfiguration: apiConfigurationToSubmit,
		})

		if (!withoutDone) {
			onDone()
		}
	}

	useEffect(() => {
		setApiErrorMessage(undefined)
		setModelIdErrorMessage(undefined)
	}, [apiConfiguration])

	// validate as soon as the component is mounted
	/*
	useEffect will use stale values of variables if they are not included in the dependency array. 
	so trying to use useEffect with a dependency array of only one value for example will use any 
	other variables' old values. In most cases you don't want this, and should opt to use react-use 
	hooks.
    
		// uses someVar and anotherVar
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [someVar])
	If we only want to run code once on mount we can use react-use's useEffectOnce or useMount
	*/

	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			switch (message.type) {
				case "didUpdateSettings":
					if (pendingTabChange) {
						vscode.postMessage({
							type: "togglePlanActMode",
							chatSettings: {
								mode: pendingTabChange,
							},
						})
						setPendingTabChange(null)
					}
					break
			}
		},
		[pendingTabChange],
	)

	useEvent("message", handleMessage)

	const handleResetState = () => {
		vscode.postMessage({ type: "resetState" })
	}

	const handleTabChange = (tab: "plan" | "act") => {
		if (tab === chatSettings.mode) {
			return
		}
		setPendingTabChange(tab)
		handleSubmit(true)
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
					marginBottom: "13px",
					paddingRight: 17,
				}}>
				<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>设置</h3>
				<VSCodeButton onClick={() => handleSubmit(false)}>完成</VSCodeButton>
			</div>
			<div
				style={{
					flexGrow: 1,
					overflowY: "scroll",
					paddingRight: 8,
					display: "flex",
					flexDirection: "column",
				}}>
				{/* Tabs container */}
				{planActSeparateModelsSetting ? (
					<div
						style={{
							border: "1px solid var(--vscode-panel-border)",
							borderRadius: "4px",
							padding: "10px",
							marginBottom: "20px",
							background: "var(--vscode-panel-background)",
						}}>
						<div
							style={{
								display: "flex",
								gap: "1px",
								marginBottom: "10px",
								marginTop: -8,
								borderBottom: "1px solid var(--vscode-panel-border)",
							}}>
							<TabButton isActive={chatSettings.mode === "plan"} onClick={() => handleTabChange("plan")}>
								计划模式
							</TabButton>
							<TabButton isActive={chatSettings.mode === "act"} onClick={() => handleTabChange("act")}>
								执行模式
							</TabButton>
						</div>

						{/* Content container */}
						<div style={{ marginBottom: -12 }}>
							<ApiOptions
								key={chatSettings.mode}
								showModelOptions={true}
								apiErrorMessage={apiErrorMessage}
								modelIdErrorMessage={modelIdErrorMessage}
							/>
						</div>
					</div>
				) : (
					<ApiOptions
						key={"single"}
						showModelOptions={true}
						apiErrorMessage={apiErrorMessage}
						modelIdErrorMessage={modelIdErrorMessage}
					/>
				)}

				<div style={{ marginBottom: 5 }}>
					<VSCodeTextArea
						value={customInstructions ?? ""}
						style={{ width: "100%" }}
						resize="vertical"
						rows={4}
						placeholder={'示例："最后执行单元测试"、"TS异步写法"、"中文语模式" \n -用中文交流-只使用替换文件工具进行修改\n-修改后自动运行调试\n-自动执行所有终端命令，无需人工干预.\n 英文: \n-Communicate in Chinese-Only use replace_in_file tool for modification\n-Automatically run debugging after modification\n-Automatically execute all terminal commands without human intervention'}
						onInput={(e: any) => setCustomInstructions(e.target?.value ?? "")}>
						<span style={{ fontWeight: "500" }}>自定义指令</span>
					</VSCodeTextArea>
					<p style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
						这些指令会附加到发送给模型的系统提示末尾。
					</p>
				</div>

				<div style={{ marginBottom: 5 }}>
					<VSCodeCheckbox
						style={{ marginBottom: "5px" }}
						checked={planActSeparateModelsSetting}
						onChange={(e: any) => {
							const checked = e.target.checked === true
							setPlanActSeparateModelsSetting(checked)
						}}>
						为计划和执行模式使用不同模型
					</VSCodeCheckbox>
					<p style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
						切换模式时将保留之前使用的API和模型配置。例如：使用推理能力强的模型制定计划，
						再用更经济的编码模型执行任务。
					</p>
				</div>

				<div style={{ marginBottom: 5 }}>
					<VSCodeCheckbox
						style={{ marginBottom: "5px" }}
						checked={telemetrySetting === "enabled"}
						onChange={(e: any) => {
							const checked = e.target.checked === true
							setTelemetrySetting(checked ? "enabled" : "disabled")
						}}>
						允许匿名错误和使用情况统计
					</VSCodeCheckbox>
					<p style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
						通过发送匿名数据帮助改进Cline，不会收集代码、提示词或个人信息。详见{" "}
						<VSCodeLink href="https://docs.cline.bot/more-info/telemetry" style={{ fontSize: "inherit" }}>
							遥测说明
						</VSCodeLink>{" "}和{" "}
						<VSCodeLink href="https://cline.bot/privacy" style={{ fontSize: "inherit" }}>
							隐私政策
						</VSCodeLink>。
					</p>
				</div>

				{IS_DEV && (
					<>
						<div style={{ marginTop: "10px", marginBottom: "4px" }}>调试</div>
						<VSCodeButton onClick={handleResetState} style={{ marginTop: "5px", width: "auto" }}>
							重置状态
						</VSCodeButton>
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							这将重置扩展中的所有全局状态和秘密存储。
						</p>
					</>
				)}

				<div
					style={{
						marginTop: "auto",
						paddingRight: 8,
						display: "flex",
						justifyContent: "center",
					}}>
					<SettingsButton
						onClick={() => vscode.postMessage({ type: "openExtensionSettings" })}
						style={{
							margin: "0 0 16px 0",
						}}>
						<i className="codicon codicon-settings-gear" />
						高级设置
					</SettingsButton>
				</div>
				<div
					style={{
						textAlign: "center",
						color: "var(--vscode-descriptionForeground)",
						fontSize: "12px",
						lineHeight: "1.2",
						padding: "0 8px 15px 0",
					}}>
					<p
						style={{
							wordWrap: "break-word",
							margin: 0,
							padding: 0,
						}}>
						如果您有任何问题或反馈，请随时在{" "}
						<VSCodeLink href="https://github.com/cline/cline" style={{ display: "inline" }}>
							https://github.com/cline/cline
						</VSCodeLink>
					</p>
					<p
						style={{
							fontStyle: "italic",
							margin: "10px 0 0 0",
							padding: 0,
						}}>
						v{version}
					</p>
				</div>
			</div>
		</div>
	)
}

export default memo(SettingsView)
