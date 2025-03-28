import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"

import styled from "styled-components"
import { McpConfig } from "../../../../src/shared/mcp"

import { vscode } from "../../utils/vscode"
import { useEffect, useState } from "react"

interface McpCreateDialogProps {
	open: boolean
	onOpenChange?: (open: boolean) => void
	mcpConfig?: McpConfig
	mcpName?: string
}

const McpCreateDialog = (props: McpCreateDialogProps) => {
	const { open, onOpenChange, mcpConfig, mcpName } = props
	const [name, setName] = useState<string>()
	const [command, setCommand] = useState<string>("npx")
	const [args, setArgs] = useState<string[]>([])
	const [argsKey, setArgsKey] = useState<string>("")
	const [env, setEnv] = useState<Record<string, string>>({})
	const [envKey, setEnvKey] = useState<string>("")
	const [envValue, setEnvValue] = useState<string>("")

	useEffect(() => {
		if (open && mcpConfig) {
			mcpConfig.args && setArgs(mcpConfig.args)
			mcpConfig.command && setCommand(mcpConfig.command)
			mcpConfig.env && setEnv(mcpConfig.env)
		}
		if (open && mcpName) {
			setName(mcpName)
		}
		if (!open) {
			setName("")
			setCommand("npx")
			setArgs([])
			setArgsKey("")
			setEnv({})
			setEnvKey("")
			setEnvValue("")
		}
	}, [open, mcpConfig, mcpName])
	const handleAddArgs = () => {
		if (argsKey && !args.includes(argsKey)) {
			const newArgs = [...args, argsKey]
			setArgs(newArgs)
			setArgsKey("")
		}
	}
	const handleAddEnv = () => {
		if (envKey && envValue) {
			const newEnv = { ...env, [envKey]: envValue }
			setEnv(newEnv)
			setEnvKey("")
			setEnvValue("")
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{mcpConfig ? "Edit" : "Add"} MCP Configuration</DialogTitle>
					<DialogDescription>
						<div style={{ width: "100%" }}>
							<VSCodeTextField
								value={name || ""}
								onInput={(e: any) => {
									setName(e.target.value)
								}}
								placeholder={"Enter MCP name"}
								disabled={!!mcpName}
								className="w-full">
								<div className="flex justify-between items-center mb-1">
									<label className="block font-medium">MCP Name</label>
								</div>
							</VSCodeTextField>
							<VSCodeTextField
								value={command || ""}
								onInput={(e: any) => {
									setCommand(e.target.value)
								}}
								placeholder={"Enter command"}
								className="w-full">
								<div className="flex justify-between items-center mb-1">
									<label className="block font-medium">CLI command for running this MCP service</label>
								</div>
							</VSCodeTextField>
							<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
								<div>
									<label className="block font-medium mb-1" data-testid="allowed-commands-heading">
										Command Arguments
									</label>
									<div className="text-vscode-descriptionForeground text-sm mt-1">
										Example: When command arguments are set to ./mcp.js and -p, and the command is set to
										node, the local MCP will start as: node ./mcp.js -p
									</div>
								</div>

								<div className="flex gap-2">
									<VSCodeTextField
										value={argsKey}
										onInput={(e: any) => setArgsKey(e.target.value)}
										placeholder="Enter command argument"
										className="grow"
										data-testid="command-input"
									/>
									<VSCodeButton
										onClick={handleAddArgs}
										style={{ minWidth: 60 }}
										data-testid="add-command-button">
										Add
									</VSCodeButton>
								</div>

								<div className="flex flex-wrap gap-2">
									{(args ?? []).map((cmd, index) => (
										<div
											key={index}
											className="border border-vscode-input-border bg-primary text-primary-foreground flex items-center gap-1 rounded-xs px-1.5 p-0.5">
											<span>{cmd}</span>
											<VSCodeButton
												appearance="icon"
												className="text-primary-foreground"
												data-testid={`remove-command-${index}`}
												onClick={() => {
													const newArgs = (args ?? []).filter((_, i) => i !== index)
													setArgs(newArgs)
												}}>
												<span className="codicon codicon-close" />
											</VSCodeButton>
										</div>
									))}
								</div>
							</div>
							<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
								<div>
									<label className="block font-medium mb-1" data-testid="allowed-commands-heading">
										env
									</label>
									<div className="text-vscode-descriptionForeground text-sm mt-1">
										Example: When this local tool needs an API key, you can configure it as
										"OPENWEATHER_API_KEY": "your-api-key"
									</div>
								</div>

								<div className="flex gap-2">
									<VSCodeTextField
										value={envKey}
										onInput={(e: any) => setEnvKey(e.target.value)}
										placeholder="Enter key"
										className="grow"
										data-testid="command-input"
									/>
									<VSCodeTextField
										value={envValue}
										onInput={(e: any) => setEnvValue(e.target.value)}
										placeholder="Enter value"
										className="grow"
										data-testid="command-input"
									/>
									<VSCodeButton
										onClick={handleAddEnv}
										style={{ minWidth: 60 }}
										data-testid="add-command-button">
										Add
									</VSCodeButton>
								</div>

								<div className="flex flex-wrap gap-2">
									{Object.entries(env || []).map(([key, value], index) => (
										<div
											key={index}
											className="border border-vscode-input-border bg-primary text-primary-foreground flex items-center gap-1 rounded-xs px-1.5 p-0.5">
											<span>
												"{key}": "{value}"
											</span>
											<VSCodeButton
												appearance="icon"
												className="text-primary-foreground"
												data-testid={`remove-command-${index}`}
												onClick={() => {
													delete env[key]
													setEnv({ ...env })
												}}>
												<span className="codicon codicon-close" />
											</VSCodeButton>
										</div>
									))}
								</div>
							</div>
						</div>
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<VSCodeButton appearance="secondary" onClick={() => onOpenChange?.(false)}>
						Cancel
					</VSCodeButton>
					<VSCodeButton
						appearance="primary"
						disabled={!name || !command}
						onClick={() => {
							vscode.postMessage({
								type: "updateMcpServices",
								newMcpConfig: {
									name: name!,
									mcpConfig: {
										...mcpConfig,
										command,
										args,
										env,
									},
								},
							})
							onOpenChange?.(false)
						}}>
						Confirm
					</VSCodeButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

export default McpCreateDialog
