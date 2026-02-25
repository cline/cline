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

	// Ensure Cline directory exists
	await fs.mkdir(clineDir, { recursive: true })

	// Write webhook config
	const config = {
		webhook_url: webhookUrl,
		webhook_token: webhookToken,
		created_at: new Date().toISOString(),
	}
	await fs.writeFile(path.join(clineDir, "webhook_config.json"), JSON.stringify(config, null, 2), "utf-8")

	// Write hook scripts
	const hooksDir = await ensureHooksDirectoryExists()

	await Promise.all([
		fs.writeFile(path.join(hooksDir, "TaskStart"), TASK_START_HOOK, "utf-8"),
		fs.writeFile(path.join(hooksDir, "PostToolUse"), POST_TOOL_USE_HOOK, "utf-8"),
		fs.writeFile(path.join(hooksDir, "TaskComplete"), TASK_COMPLETE_HOOK, "utf-8"),
	])

	Logger.info(`LG webhooks configured: ${webhookUrl}`)
}

// -- Hook script contents (PowerShell) --

const TASK_START_HOOK = `#!/usr/bin/env pwsh
# Cline Hook: TaskStart
# Fires when Cline begins a new task.
# Reads webhook config and POSTs a task_started event to the dashboard.

$ErrorActionPreference = "SilentlyContinue"

# Read hook input from stdin (Cline sends JSON)
$hookInput = $input | Out-String | ConvertFrom-Json

# Load webhook config
$configPath = Join-Path $HOME "Documents" "Cline" "webhook_config.json"
if (-not (Test-Path $configPath)) {
    # No webhook configured, output empty response and exit
    Write-Output '{"cancel": false}'
    exit 0
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json

# Extract useful info from hook input
$taskMetadata = @{}
if ($hookInput.taskStart -and $hookInput.taskStart.taskMetadata) {
    $taskMetadata = $hookInput.taskStart.taskMetadata
}

$payload = @{
    event = "task_started"
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
    data = @{
        task_id = if ($hookInput.taskId) { $hookInput.taskId } else { "" }
        cline_version = if ($hookInput.clineVersion) { $hookInput.clineVersion } else { "" }
        workspace_roots = if ($hookInput.workspaceRoots) { $hookInput.workspaceRoots } else { @() }
        task_metadata = $taskMetadata
    }
} | ConvertTo-Json -Depth 5 -Compress

# POST to webhook (fire-and-forget, 5 second timeout)
try {
    $headers = @{
        "Content-Type" = "application/json"
        "Authorization" = "Bearer $($config.webhook_token)"
    }
    Invoke-RestMethod -Uri $config.webhook_url -Method Post -Body $payload -Headers $headers -TimeoutSec 5 | Out-Null
} catch {
    # Fire-and-forget: don't block Cline if the webhook is unreachable
}

# Output valid hook response (don't cancel, no context modification)
Write-Output '{"cancel": false}'
`

const POST_TOOL_USE_HOOK = `#!/usr/bin/env pwsh
# Cline Hook: PostToolUse
# Fires after each tool execution (file writes, commands, etc.).
# Reads webhook config and POSTs a tool_executed event to the dashboard.

$ErrorActionPreference = "SilentlyContinue"

# Read hook input from stdin (Cline sends JSON)
$hookInput = $input | Out-String | ConvertFrom-Json

# Load webhook config
$configPath = Join-Path $HOME "Documents" "Cline" "webhook_config.json"
if (-not (Test-Path $configPath)) {
    Write-Output '{"cancel": false}'
    exit 0
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json

# Extract tool execution data
$toolData = if ($hookInput.postToolUse) { $hookInput.postToolUse } else { @{} }

$payload = @{
    event = "tool_executed"
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
    data = @{
        task_id = if ($hookInput.taskId) { $hookInput.taskId } else { "" }
        tool_name = if ($toolData.toolName) { $toolData.toolName } else { "" }
        parameters = if ($toolData.parameters) { $toolData.parameters } else { @{} }
        success = if ($null -ne $toolData.success) { $toolData.success } else { $false }
        execution_time_ms = if ($toolData.executionTimeMs) { $toolData.executionTimeMs } else { 0 }
    }
} | ConvertTo-Json -Depth 5 -Compress

# POST to webhook (fire-and-forget, 5 second timeout)
try {
    $headers = @{
        "Content-Type" = "application/json"
        "Authorization" = "Bearer $($config.webhook_token)"
    }
    Invoke-RestMethod -Uri $config.webhook_url -Method Post -Body $payload -Headers $headers -TimeoutSec 5 | Out-Null
} catch {
    # Fire-and-forget: don't block Cline if the webhook is unreachable
}

# Output valid hook response
Write-Output '{"cancel": false}'
`

const TASK_COMPLETE_HOOK = `#!/usr/bin/env pwsh
# Cline Hook: TaskComplete
# Fires when Cline finishes a task successfully.
# Reads webhook config and POSTs a task_completed event to the dashboard.

$ErrorActionPreference = "SilentlyContinue"

# Read hook input from stdin (Cline sends JSON)
$hookInput = $input | Out-String | ConvertFrom-Json

# Load webhook config
$configPath = Join-Path $HOME "Documents" "Cline" "webhook_config.json"
if (-not (Test-Path $configPath)) {
    Write-Output '{"cancel": false}'
    exit 0
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json

# Extract task completion data
$taskData = if ($hookInput.taskComplete) { $hookInput.taskComplete } else { @{} }
$taskMetadata = if ($taskData.taskMetadata) { $taskData.taskMetadata } else { @{} }

$payload = @{
    event = "task_completed"
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
    data = @{
        task_id = if ($hookInput.taskId) { $hookInput.taskId } else { "" }
        task_metadata = $taskMetadata
    }
} | ConvertTo-Json -Depth 5 -Compress

# POST to webhook (fire-and-forget, 5 second timeout)
try {
    $headers = @{
        "Content-Type" = "application/json"
        "Authorization" = "Bearer $($config.webhook_token)"
    }
    Invoke-RestMethod -Uri $config.webhook_url -Method Post -Body $payload -Headers $headers -TimeoutSec 5 | Out-Null
} catch {
    # Fire-and-forget: don't block Cline if the webhook is unreachable
}

# Output valid hook response
Write-Output '{"cancel": false}'
`
