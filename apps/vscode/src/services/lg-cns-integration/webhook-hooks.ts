import fs from "fs/promises"
import path from "path"
import { ensureHooksDirectoryExists, getDocumentsPath } from "@/core/storage/disk"

type LgHookScript = {
	fileName: string
	content: string
	mode?: number
}

export async function writeLgWebhookConfig(webhookUrl: string, webhookToken: string): Promise<void> {
	const documentsPath = await getDocumentsPath()
	const clineDir = path.join(documentsPath, "Cline")
	const configPath = path.join(clineDir, "webhook_config.json")

	await fs.mkdir(clineDir, { recursive: true })
	await fs.writeFile(
		configPath,
		JSON.stringify(
			{
				webhook_url: webhookUrl,
				webhook_token: webhookToken,
				created_at: new Date().toISOString(),
			},
			null,
			2,
		),
		"utf-8",
	)
}

export async function writeLgWebhookHooks(): Promise<void> {
	const hooksDir = await ensureHooksDirectoryExists()
	const hooks = getLgWebhookHookScripts()

	for (const hook of hooks) {
		const hookPath = path.join(hooksDir, hook.fileName)
		await fs.writeFile(hookPath, hook.content, "utf-8")
		if (hook.mode !== undefined) {
			await fs.chmod(hookPath, hook.mode)
		}
	}
}

function getLgWebhookHookScripts(): LgHookScript[] {
	if (process.platform === "win32") {
		return [
			{ fileName: "TaskStart.ps1", content: TASK_START_POWERSHELL },
			{ fileName: "PostToolUse.ps1", content: POST_TOOL_USE_POWERSHELL },
			{ fileName: "TaskComplete.ps1", content: TASK_COMPLETE_POWERSHELL },
		]
	}

	return [
		{ fileName: "TaskStart", content: TASK_START_NODE, mode: 0o755 },
		{ fileName: "PostToolUse", content: POST_TOOL_USE_NODE, mode: 0o755 },
		{ fileName: "TaskComplete", content: TASK_COMPLETE_NODE, mode: 0o755 },
	]
}

const TASK_START_POWERSHELL = `try {
    $rawInput = [Console]::In.ReadToEnd()
    $inputData = $null
    if ($rawInput) {
        $inputData = $rawInput | ConvertFrom-Json -Depth 100
    }
} catch {
    $inputData = $null
}

try {
    $documentsPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::MyDocuments)
    if (-not $documentsPath) {
        $documentsPath = Join-Path $HOME "Documents"
    }

    $configPath = Join-Path (Join-Path $documentsPath "Cline") "webhook_config.json"
    if (-not (Test-Path $configPath)) {
        @{ cancel = $false } | ConvertTo-Json -Compress
        exit 0
    }

    $config = Get-Content $configPath -Raw | ConvertFrom-Json -Depth 100
    if (-not $config.webhook_url -or -not $config.webhook_token) {
        @{ cancel = $false } | ConvertTo-Json -Compress
        exit 0
    }

    $workspaceRoots = @()
    if ($inputData -and $null -ne $inputData.workspaceRoots) {
        $workspaceRoots = $inputData.workspaceRoots
    }

    $taskMetadata = @{}
    if ($inputData -and $inputData.taskStart -and $null -ne $inputData.taskStart.taskMetadata) {
        $taskMetadata = $inputData.taskStart.taskMetadata
    }

    $payload = @{
        event = "task_started"
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        data = @{
            task_id = if ($inputData) { $inputData.taskId } else { $null }
            cline_version = if ($inputData) { $inputData.clineVersion } else { $null }
            workspace_roots = $workspaceRoots
            task_metadata = $taskMetadata
        }
    }

    $headers = @{
        Authorization = "Bearer $($config.webhook_token)"
        "Content-Type" = "application/json"
    }

    Invoke-RestMethod -Method Post -Uri $config.webhook_url -Headers $headers -Body ($payload | ConvertTo-Json -Depth 100) -ContentType "application/json" -TimeoutSec 5 | Out-Null
} catch {}

@{ cancel = $false } | ConvertTo-Json -Compress
`

const POST_TOOL_USE_POWERSHELL = `try {
    $rawInput = [Console]::In.ReadToEnd()
    $inputData = $null
    if ($rawInput) {
        $inputData = $rawInput | ConvertFrom-Json -Depth 100
    }
} catch {
    $inputData = $null
}

try {
    $documentsPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::MyDocuments)
    if (-not $documentsPath) {
        $documentsPath = Join-Path $HOME "Documents"
    }

    $configPath = Join-Path (Join-Path $documentsPath "Cline") "webhook_config.json"
    if (-not (Test-Path $configPath)) {
        @{ cancel = $false } | ConvertTo-Json -Compress
        exit 0
    }

    $config = Get-Content $configPath -Raw | ConvertFrom-Json -Depth 100
    if (-not $config.webhook_url -or -not $config.webhook_token) {
        @{ cancel = $false } | ConvertTo-Json -Compress
        exit 0
    }

    $toolData = $null
    if ($inputData -and $inputData.postToolUse) {
        $toolData = $inputData.postToolUse
    }

    $payload = @{
        event = "tool_executed"
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        data = @{
            task_id = if ($inputData) { $inputData.taskId } else { $null }
            tool_name = if ($toolData) { $toolData.toolName } else { $null }
            parameters = if ($toolData -and $null -ne $toolData.parameters) { $toolData.parameters } else { @{} }
            success = if ($toolData) { [bool]$toolData.success } else { $false }
            execution_time_ms = if ($toolData) { $toolData.executionTimeMs } else { $null }
        }
    }

    $headers = @{
        Authorization = "Bearer $($config.webhook_token)"
        "Content-Type" = "application/json"
    }

    Invoke-RestMethod -Method Post -Uri $config.webhook_url -Headers $headers -Body ($payload | ConvertTo-Json -Depth 100) -ContentType "application/json" -TimeoutSec 5 | Out-Null
} catch {}

@{ cancel = $false } | ConvertTo-Json -Compress
`

const TASK_COMPLETE_POWERSHELL = `try {
    $rawInput = [Console]::In.ReadToEnd()
    $inputData = $null
    if ($rawInput) {
        $inputData = $rawInput | ConvertFrom-Json -Depth 100
    }
} catch {
    $inputData = $null
}

try {
    $documentsPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::MyDocuments)
    if (-not $documentsPath) {
        $documentsPath = Join-Path $HOME "Documents"
    }

    $configPath = Join-Path (Join-Path $documentsPath "Cline") "webhook_config.json"
    if (-not (Test-Path $configPath)) {
        @{ cancel = $false } | ConvertTo-Json -Compress
        exit 0
    }

    $config = Get-Content $configPath -Raw | ConvertFrom-Json -Depth 100
    if (-not $config.webhook_url -or -not $config.webhook_token) {
        @{ cancel = $false } | ConvertTo-Json -Compress
        exit 0
    }

    $taskMetadata = @{}
    if ($inputData -and $inputData.taskComplete -and $null -ne $inputData.taskComplete.taskMetadata) {
        $taskMetadata = $inputData.taskComplete.taskMetadata
    }

    $payload = @{
        event = "task_completed"
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        data = @{
            task_id = if ($inputData) { $inputData.taskId } else { $null }
            task_metadata = $taskMetadata
        }
    }

    $headers = @{
        Authorization = "Bearer $($config.webhook_token)"
        "Content-Type" = "application/json"
    }

    Invoke-RestMethod -Method Post -Uri $config.webhook_url -Headers $headers -Body ($payload | ConvertTo-Json -Depth 100) -ContentType "application/json" -TimeoutSec 5 | Out-Null
} catch {}

@{ cancel = $false } | ConvertTo-Json -Compress
`

const NODE_HOOK_SHARED = `#!/usr/bin/env node
const fs = require("fs/promises")
const os = require("os")
const path = require("path")

async function readConfig() {
  const configPath = path.join(os.homedir(), "Documents", "Cline", "webhook_config.json")
  try {
    const rawConfig = await fs.readFile(configPath, "utf-8")
    const config = JSON.parse(rawConfig)
    if (!config.webhook_url || !config.webhook_token) {
      return null
    }
    return config
  } catch {
    return null
  }
}

async function postEvent(config, payload) {
  let timeout
  try {
    const controller = new AbortController()
    timeout = setTimeout(() => controller.abort(), 5000)
    await fetch(config.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: \`Bearer \${config.webhook_token}\`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
  } catch {} finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

async function main(buildPayload) {
  let input = {}
  try {
    const rawInput = await fs.readFile(0, "utf-8")
    input = rawInput ? JSON.parse(rawInput) : {}
  } catch {}

  const config = await readConfig()
  if (config) {
    await postEvent(config, buildPayload(input))
  }

  process.stdout.write(JSON.stringify({ cancel: false }))
}
`

const TASK_START_NODE = `${NODE_HOOK_SHARED}
main((input) => ({
  event: "task_started",
  timestamp: new Date().toISOString(),
  data: {
    task_id: input.taskId ?? null,
    cline_version: input.clineVersion ?? null,
    workspace_roots: input.workspaceRoots ?? [],
    task_metadata: input.taskStart?.taskMetadata ?? {},
  },
}))
`

const POST_TOOL_USE_NODE = `${NODE_HOOK_SHARED}
main((input) => ({
  event: "tool_executed",
  timestamp: new Date().toISOString(),
  data: {
    task_id: input.taskId ?? null,
    tool_name: input.postToolUse?.toolName ?? null,
    parameters: input.postToolUse?.parameters ?? {},
    success: Boolean(input.postToolUse?.success),
    execution_time_ms: input.postToolUse?.executionTimeMs ?? null,
  },
}))
`

const TASK_COMPLETE_NODE = `${NODE_HOOK_SHARED}
main((input) => ({
  event: "task_completed",
  timestamp: new Date().toISOString(),
  data: {
    task_id: input.taskId ?? null,
    task_metadata: input.taskComplete?.taskMetadata ?? {},
  },
}))
`
