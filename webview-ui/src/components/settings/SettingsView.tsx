import { VSCodeButton, VSCodeLink, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration, validateModelId } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import ApiOptions from "./ApiOptions"
import LanguageOptions from "./LanguageOptions"
import SettingsButton from "../common/SettingsButton"

const IS_DEV = false // FIXME: use flags when packaging

type SettingsViewProps = {
	onDone: () => void
}

const SettingsView = ({ onDone }: SettingsViewProps) => {
	const { t } = useTranslation("translation", { keyPrefix: "settingsView", useSuspense: false })
	const { apiConfiguration, version, customInstructions, setCustomInstructions, openRouterModels } = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [modelIdErrorMessage, setModelIdErrorMessage] = useState<string | undefined>(undefined)

	const handleSubmit = () => {
		const apiValidationResult = validateApiConfiguration(apiConfiguration)
		const modelIdValidationResult = validateModelId(apiConfiguration, openRouterModels)

		setApiErrorMessage(apiValidationResult)
		setModelIdErrorMessage(modelIdValidationResult)

		if (!apiValidationResult && !modelIdValidationResult) {
			vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
			vscode.postMessage({
				type: "customInstructions",
				text: customInstructions,
			})
			onDone()
		}
	}

	useEffect(() => {
		setApiErrorMessage(undefined)
		setModelIdErrorMessage(undefined)
	}, [apiConfiguration])

	// validate as soon as the component is mounted
	/*
	useEffect will use stale values of variables if they are not included in the dependency array. so trying to use useEffect with a dependency array of only one value for example will use any other variables' old values. In most cases you don't want this, and should opt to use react-use hooks.

	useEffect(() => {
		// uses someVar and anotherVar
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [someVar])

	If we only want to run code once on mount we can use react-use's useEffectOnce or useMount
	*/

	const handleResetState = () => {
		vscode.postMessage({ type: "resetState" })
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
				<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>{t("settings")}</h3>
				<VSCodeButton onClick={handleSubmit}>{t("done")}</VSCodeButton>
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
					<ApiOptions
						showModelOptions={true}
						apiErrorMessage={apiErrorMessage}
						modelIdErrorMessage={modelIdErrorMessage}
					/>
				</div>

				<div style={{ marginBottom: 5 }}>
					<VSCodeTextArea
						value={customInstructions ?? ""}
						style={{ width: "100%" }}
						resize="vertical"
						rows={4}
						placeholder={t("customInstructionsPlaceholder")}
						onInput={(e: any) => setCustomInstructions(e.target?.value ?? "")}>
						<span style={{ fontWeight: "500" }}>{t("customInstructions")}</span>
					</VSCodeTextArea>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						{t("customInstructionsDescription")}
					</p>
				</div>
				<div style={{ marginBottom: 5 }}>
					<LanguageOptions />
				</div>

				{IS_DEV && (
					<>
						<div style={{ marginTop: "10px", marginBottom: "4px" }}>{t("debug")}</div>
						<VSCodeButton onClick={handleResetState} style={{ marginTop: "5px", width: "auto" }}>
							{t("resetState")}
						</VSCodeButton>
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							{t("resetStateDescription")}
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
						Advanced Settings
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
						{t("feedback")}{" "}
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
