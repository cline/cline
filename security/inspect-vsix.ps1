param(
	[Parameter(Mandatory = $true)]
	[string]$VsixPath
)

$ErrorActionPreference = "Stop"
$resolvedVsix = (Resolve-Path -LiteralPath $VsixPath).Path
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedVsix)

try {
	$entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
	$requiredEntries = @(
		"extension/package.json",
		"extension/dist/extension.js",
		"extension/LICENSE.txt",
		"extension/NOTICE"
	)
	foreach ($requiredEntry in $requiredEntries) {
		if ($entries -notcontains $requiredEntry) {
			throw "VSIX is missing required entry: $requiredEntry"
		}
	}

	$forbiddenPatterns = @(
		"(^|/)node_modules/",
		"(^|/)src/",
		"\.map$",
		"webhook-hooks",
		"lg-cns-integration",
		"mcp-oauth-test-server"
	)
	foreach ($entry in $entries) {
		foreach ($pattern in $forbiddenPatterns) {
			if ($entry -match $pattern) {
				throw "VSIX contains forbidden entry: $entry"
			}
		}
	}

	$secretPatterns = @(
		"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
		"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
		"\bgh[pousr]_[A-Za-z0-9]{36,}\b",
		"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"
	)
	$forbiddenBundlePatterns = @(
		"webhook-hooks",
		"lg-cns-integration",
		"new SSEClientTransport",
		"new StreamableHTTPClientTransport",
		"open-graph-scraper",
		"reconnecting-eventsource",
		"models.dev"
	)
	foreach ($entry in $archive.Entries) {
		if (
			$entry.Length -gt 20MB -or
			$entry.FullName -notmatch "\.(?:js|json|html|css|md|txt|xml|svg)$"
		) {
			continue
		}
		$entryReader = [System.IO.StreamReader]::new($entry.Open())
		try {
			$entryText = $entryReader.ReadToEnd()
		} finally {
			$entryReader.Dispose()
		}
		foreach ($pattern in $secretPatterns) {
			if ($entryText -match $pattern) {
				throw "VSIX contains a potential high-confidence secret in: $($entry.FullName)"
			}
		}
		if ($entry.FullName -eq "extension/dist/extension.js") {
			foreach ($pattern in $forbiddenBundlePatterns) {
				if ($entryText.Contains($pattern)) {
					throw "VSIX bundle contains a prohibited release marker: $pattern"
				}
			}
		}
	}

	$manifestEntry = $archive.GetEntry("extension/package.json")
	$reader = [System.IO.StreamReader]::new($manifestEntry.Open())
	try {
		$manifest = $reader.ReadToEnd() | ConvertFrom-Json
	} finally {
		$reader.Dispose()
	}
	if (
		$manifest.name -ne "bedrock-coder" -or
		$manifest.publisher -ne "fffalexgo" -or
		$manifest.displayName -ne "Bedrock Coder" -or
		$manifest.main -ne "./dist/extension.js"
	) {
		throw "VSIX manifest identity or entry point is not the approved Bedrock Coder identity."
	}

	Write-Output "[vsix] verified $($entries.Count) archive entries and Bedrock Coder identity"
} finally {
	$archive.Dispose()
}
