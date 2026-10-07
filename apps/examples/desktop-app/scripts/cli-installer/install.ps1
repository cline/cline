param(
    [string]$Release,
    [string]$Version,
    [ValidateSet('x86_64-pc-windows-msvc', 'universal-apple-darwin', 'x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu')]
    [string]$Target,
    [string]$InstallDir = (Join-Path $env:USERPROFILE '.cline\bin'),
    [string]$Binary,
    [switch]$NoModifyPath
)
$ErrorActionPreference = 'Stop'
function Get-RuntimeChecksum([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha256.Dispose() }
}
if ($Version) { $Release = "desktop-v$($Version.TrimStart('v'))" }
# Desktop currently publishes x64 Windows runtimes (also usable under ARM64 emulation).
if (-not $Target) { $Target = 'x86_64-pc-windows-msvc' }
if (-not $Binary -and $Release -notmatch '^desktop-(v\d+\.\d+\.\d+(-beta\.\d+)?|nightly-\d+)$') {
    throw 'Provide an exact desktop release tag with -Release or -Version'
}
if (-not $PSBoundParameters.ContainsKey('InstallDir')) {
    $existing = Get-Command cline -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing -and $existing.Source -and $existing.Source -ne (Join-Path $InstallDir 'cline.exe')) {
        if ($Binary) { $expectedBuild = (& $Binary --runtime-build-id).Trim() }
        else {
            $asset = "cline-runtime-$Target" + $(if ($Target -like '*windows*') { '.exe' } else { '' })
            $expectedBuild = (Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/cline/cline/releases/download/$Release/$asset.build-id" -TimeoutSec 30).Content.Trim()
        }
        $previousAutoUpdate = $env:CLINE_NO_AUTO_UPDATE
        try {
            $env:CLINE_NO_AUTO_UPDATE = '1'
            $info = (& $existing.Source --runtime-info | Out-String | ConvertFrom-Json)
        } catch { throw "Update or remove the existing CLI at $($existing.Source) before installing; no second copy was installed" }
        finally { $env:CLINE_NO_AUTO_UPDATE = $previousAutoUpdate }
        if ($info.target -ne $Target) { throw "Existing CLI target $($info.target) does not match requested $Target; use -InstallDir for a different machine" }
        if (-not $info.compiled -or -not $expectedBuild -or $info.buildId -ne $expectedBuild) {
            throw "Existing CLI at $($existing.Source) has an incompatible SDK build; update or remove it before installing"
        }
        if (-not (Test-Path -LiteralPath $info.executablePath -PathType Leaf)) { throw 'Invalid installed executable path' }
        Write-Output $info.executablePath
        exit 0
    }
}
$extension = if ($Target -like '*windows*') { '.exe' } else { '' }
$destination = Join-Path $InstallDir "cline$extension"
New-Item -ItemType Directory -Force $InstallDir | Out-Null
$lock = $null
try {
    for ($attempt = 0; $attempt -lt 240; $attempt++) {
        try { $lock = [System.IO.File]::Open((Join-Path $InstallDir '.install-lock'), 'OpenOrCreate', 'ReadWrite', 'None'); break }
        catch [System.IO.IOException] { Start-Sleep -Milliseconds 500 }
    }
    if (-not $lock) { throw 'Timed out waiting for another runtime installer' }
    $checksumPath = "$destination.sha256"
    $releasePath = Join-Path $InstallDir 'release'
    $cached = -not $Binary -and (Test-Path $destination) -and (Test-Path $checksumPath) -and (Test-Path $releasePath)
    if ($cached) {
        $cached = (Get-Content $releasePath -Raw).Trim() -eq "$Release/$Target" -and (Get-RuntimeChecksum $destination) -eq (Get-Content $checksumPath -Raw).Trim()
    }
    if (-not $cached) {
        $temporary = Join-Path $InstallDir ([Guid]::NewGuid().ToString())
        New-Item -ItemType Directory $temporary | Out-Null
        try {
            $download = Join-Path $temporary "cline$extension"
            if ($Binary) { Copy-Item -LiteralPath $Binary $download }
            else {
                $asset = "cline-runtime-$Target$extension"
                $url = "https://github.com/cline/cline/releases/download/$Release/$asset"
                Write-Host "Installing Cline runtime $Release ($Target)…"
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                Invoke-WebRequest -UseBasicParsing -Uri "$url.sha256" -OutFile (Join-Path $temporary 'checksum') -TimeoutSec 180
                $expected = ((Get-Content (Join-Path $temporary 'checksum') -Raw).Trim() -split '\s+')[0]
                if ($expected -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid release checksum' }
                Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $download -TimeoutSec 180
                if ((Get-RuntimeChecksum $download) -ne $expected) { throw 'Runtime checksum mismatch' }
            }
            $expectedEpoch = $env:CLINE_INSTALL_BUILD_EPOCH_MS
            if (-not $expectedEpoch) {
                if ($Binary) { $expectedEpoch = (& $Binary --runtime-build-epoch | Out-String).Trim() }
                else { $expectedEpoch = (Invoke-WebRequest -UseBasicParsing -Uri "$url.build-epoch" -TimeoutSec 30).Content.Trim() }
            }
            if ($expectedEpoch -notmatch '^\d+$') { throw 'Invalid runtime build epoch' }
            $epochPath = "$destination.build-epoch"
            $installedEpoch = if (Test-Path $epochPath) { (Get-Content $epochPath -Raw).Trim() } else { '0' }
            if ($Target -like '*windows*' -and (Test-Path $destination)) {
                try { $actualEpoch = (& $destination --runtime-build-epoch | Out-String).Trim(); if ($actualEpoch -match '^\d+$') { $installedEpoch = $actualEpoch } } catch { }
            }
            if ($installedEpoch -match '^\d+$' -and [long]$installedEpoch -gt [long]$expectedEpoch) { throw 'The installed CLI is newer; no downgrade was installed' }
            # One shared runtime is upgraded in place. Windows refuses replacement
            # while it is running; close its sessions and Hub before retrying.
            Move-Item -Force $download $destination
            (Get-RuntimeChecksum $destination) | Set-Content $checksumPath
            "$Release/$Target" | Set-Content $releasePath
            "$expectedEpoch" | Set-Content $epochPath
        } finally { Remove-Item -Recurse -Force $temporary }
    }
} finally { if ($lock) { $lock.Dispose() } }
if (-not $NoModifyPath) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($InstallDir -notin ($userPath -split ';')) {
        [Environment]::SetEnvironmentVariable('Path', "$InstallDir;$userPath", 'User')
    }
    Write-Host 'Open a new terminal to use cline.'
}
Write-Output $destination
