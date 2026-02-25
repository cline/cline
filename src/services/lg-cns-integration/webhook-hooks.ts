import fs from "fs/promises"
import path from "path"
import { ensureHooksDirectoryExists, getDocumentsPath } from "@/core/storage/disk"
import { Logger } from "@/shared/services/Logger"

/**
 * Sets up webhook hooks for LG CNS dashboard integration.
 *
 * Writes a webhook config file and installs PowerShell hook scripts
 * to ~/Documents/Cline/Hooks/ that POST progress events back to
 * the LG web dashboard.
 */
export async function setupLgWebhooks(webhookUrl: string, webhookToken: string): Promise<void> {
	const documentsPath = await getDocumentsPath()
	const clineDir = path.join(documentsPath, "Cline")

	await fs.mkdir(clineDir, { recursive: true })

	// Write webhook config next to hooks in ~/Documents/Cline/
	const configPath = path.join(clineDir, "webhook_config.json")
	const config = {
		webhook_url: webhookUrl,
		webhook_token: webhookToken,
		created_at: new Date().toISOString(),
	}
	await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8")

	// Write hook scripts with the resolved config path baked in,
	// so hooks don't need to guess the Documents folder location at runtime
	const hooksDir = await ensureHooksDirectoryExists()

	await Promise.all([
		fs.writeFile(path.join(hooksDir, "TaskStart"), makeHookScript("task_started", TASK_START_DATA, configPath), "utf-8"),
		fs.writeFile(
			path.join(hooksDir, "PostToolUse"),
			makeHookScript("tool_executed", POST_TOOL_USE_DATA, configPath),
			"utf-8",
		),
		fs.writeFile(
			path.join(hooksDir, "TaskComplete"),
			makeHookScript("task_completed", TASK_COMPLETE_DATA, configPath),
			"utf-8",
		),
	])

	Logger.info(`LG webhooks configured: ${webhookUrl}`)
}

// -- Hook script generation --

/**
 * Generates a PowerShell hook script that reads stdin JSON from Cline,
 * extracts event-specific data, and POSTs a webhook event.
 *
 * The config path is resolved at generation time and embedded in the script,
 * so hooks work correctly even if the Documents folder is in a non-standard
 * location (e.g., OneDrive, different drive on Windows).
 */
function makeHookScript(eventName: string, dataExtraction: string, configPath: string): string {
	// Escape backslashes for embedding in the PowerShell string
	const escapedConfigPath = configPath.replace(/\\/g, "\\\\")

	return `#!/usr/bin/env pwsh
$ErrorActionPreference = "SilentlyContinue"

# Read hook input from stdin (Cline sends JSON)
$hookInput = $input | Out-String | ConvertFrom-Json

# Load webhook config (path resolved at install time by the Cline extension)
$configPath = "${escapedConfigPath}"
if (-not (Test-Path $configPath)) {
    Write-Output '{"cancel": false}'
    exit 0
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json

# Extract event-specific data
${dataExtraction}

$payload = @{
    event = "${eventName}"
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
    data = $eventData
} | ConvertTo-Json -Depth 5 -Compress

# POST to webhook (fire-and-forget, 5 second timeout)
try {
    $headers = @{
        "Content-Type" = "application/json"
        "Authorization" = "Bearer $($config.webhook_token)"
    }
    Invoke-RestMethod -Uri $config.webhook_url -Method Post -Body $payload -Headers $headers -TimeoutSec 5 | Out-Null
} catch {}

Write-Output '{"cancel": false}'
`
}

// Each extraction block sets $eventData from $hookInput

const TASK_START_DATA = `$taskMetadata = @{}
if ($hookInput.taskStart -and $hookInput.taskStart.taskMetadata) {
    $taskMetadata = $hookInput.taskStart.taskMetadata
}
$eventData = @{
    task_id = if ($hookInput.taskId) { $hookInput.taskId } else { "" }
    cline_version = if ($hookInput.clineVersion) { $hookInput.clineVersion } else { "" }
    workspace_roots = if ($hookInput.workspaceRoots) { $hookInput.workspaceRoots } else { @() }
    task_metadata = $taskMetadata
}`

const POST_TOOL_USE_DATA = `$toolData = if ($hookInput.postToolUse) { $hookInput.postToolUse } else { @{} }
$eventData = @{
    task_id = if ($hookInput.taskId) { $hookInput.taskId } else { "" }
    tool_name = if ($toolData.toolName) { $toolData.toolName } else { "" }
    parameters = if ($toolData.parameters) { $toolData.parameters } else { @{} }
    success = if ($null -ne $toolData.success) { $toolData.success } else { $false }
    execution_time_ms = if ($toolData.executionTimeMs) { $toolData.executionTimeMs } else { 0 }
}`

const TASK_COMPLETE_DATA = `$taskData = if ($hookInput.taskComplete) { $hookInput.taskComplete } else { @{} }
$taskMetadata = if ($taskData.taskMetadata) { $taskData.taskMetadata } else { @{} }
$eventData = @{
    task_id = if ($hookInput.taskId) { $hookInput.taskId } else { "" }
    task_metadata = $taskMetadata
}`
