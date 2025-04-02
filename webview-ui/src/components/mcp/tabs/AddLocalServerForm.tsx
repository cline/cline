import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { vscode } from "../../../utils/vscode"
import styled from "styled-components"

type AddLocalServerFormProps = {
	onServerAdded: () => void
}

const AddLocalServerForm = ({ onServerAdded }: AddLocalServerFormProps) => {
	const [serverName, setServerName] = useState("")
	const [command, setCommand] = useState("")
	const [args, setArgs] = useState<string[]>([])
	const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([])
	const [newArg, setNewArg] = useState("")
	const [newEnvKey, setNewEnvKey] = useState("")
	const [newEnvValue, setNewEnvValue] = useState("")

	const handleSubmit = () => {
		// vscode.postMessage({
		// 	type: "addLocalMcpServer",
		// 	serverName,
		// 	command,
		// 	args,
		// 	env: Object.fromEntries(envVars.map(({ key, value }) => [key, value])),
		// })
		onServerAdded()
	}

	const addArg = () => {
		if (newArg.trim()) {
			setArgs([...args, newArg.trim()])
			setNewArg("")
		}
	}

	const removeArg = (index: number) => {
		setArgs(args.filter((_, i) => i !== index))
	}

	const addEnvVar = () => {
		if (newEnvKey.trim() && newEnvValue.trim()) {
			setEnvVars([...envVars, { key: newEnvKey.trim(), value: newEnvValue.trim() }])
			setNewEnvKey("")
			setNewEnvValue("")
		}
	}

	const removeEnvVar = (index: number) => {
		setEnvVars(envVars.filter((_, i) => i !== index))
	}

	return (
		<FormContainer>
			<div className="text-[var(--vscode-foreground)] text-sm max-w-lg">
				Add a local MCP server by providing a name and its command. Learn more here.
			</div>
			<VSCodeTextField
				value={serverName}
				onChange={(e) => setServerName((e.target as HTMLInputElement).value)}
				placeholder="mcp-server">
				Server Name
			</VSCodeTextField>
			<VSCodeTextField
				value={command}
				onChange={(e) => setCommand((e.target as HTMLInputElement).value)}
				placeholder="npx mcp-server">
				Command
			</VSCodeTextField>

			<Section>
				<div style={{ marginBottom: 2 }}>Arguments</div>
				<div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
					<VSCodeTextField
						value={newArg}
						onChange={(e) => setNewArg((e.target as HTMLInputElement).value)}
						placeholder="New Argument"
						style={{ flex: 1 }}
					/>
					<VSCodeButton onClick={addArg}>Add</VSCodeButton>
				</div>
				{args.map((arg, index) => (
					<ArgItem key={index}>
						<span>{arg}</span>
						<VSCodeButton appearance="icon" onClick={() => removeArg(index)}>
							<span className="codicon codicon-close"></span>
						</VSCodeButton>
					</ArgItem>
				))}
			</Section>

			<Section>
				<div style={{ marginBottom: 2 }}>Environment Variables</div>
				<div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
					<VSCodeTextField
						value={newEnvKey}
						onChange={(e) => setNewEnvKey((e.target as HTMLInputElement).value)}
						placeholder="Key"
						style={{ flex: 1 }}
					/>
					<VSCodeTextField
						value={newEnvValue}
						onChange={(e) => setNewEnvValue((e.target as HTMLInputElement).value)}
						placeholder="Value"
						style={{ flex: 1 }}
					/>
					<VSCodeButton onClick={addEnvVar}>Add</VSCodeButton>
				</div>
				{envVars.map((env, index) => (
					<ArgItem key={index}>
						<span>
							{env.key}={env.value}
						</span>
						<VSCodeButton appearance="icon" onClick={() => removeEnvVar(index)}>
							<span className="codicon codicon-close"></span>
						</VSCodeButton>
					</ArgItem>
				))}
			</Section>

			<VSCodeButton onClick={handleSubmit} disabled={!serverName.trim() || !command.trim()} style={{ marginTop: "0px" }}>
				Add Server
			</VSCodeButton>

			<VSCodeButton
				appearance="secondary"
				style={{ width: "100%", marginBottom: "5px", marginTop: 8 }}
				onClick={() => {
					vscode.postMessage({ type: "openMcpSettings" })
				}}>
				Edit Configuration
			</VSCodeButton>
		</FormContainer>
	)
}

const FormContainer = styled.div`
	padding: 16px 20px;
	display: flex;
	flex-direction: column;
	gap: 8px;
`

const Section = styled.div`
	h4 {
		margin: 0 0 8px 0;
		color: var(--vscode-foreground);
	}
`

const ArgItem = styled.div`
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 4px 8px;
	background: var(--vscode-textCodeBlock-background);
	border-radius: 4px;
	margin-bottom: 4px;

	span {
		color: var(--vscode-foreground);
	}
`

export default AddLocalServerForm
