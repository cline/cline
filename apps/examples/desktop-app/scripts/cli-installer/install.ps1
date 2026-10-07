param(
    [string]$Release,
    [string]$Version,
    [ValidateSet('x86_64-pc-windows-msvc', 'universal-apple-darwin', 'x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu')]
    [string]$Target,
    [string]$InstallDir = (Join-Path $env:USERPROFILE '.cline\bin'),
    [string]$Binary,
    [switch]$Managed,
    [switch]$ReplaceExisting,
    [switch]$NoModifyPath
)
$ErrorActionPreference = 'Stop'
$managedInstall = $Managed -or -not $PSBoundParameters.ContainsKey('InstallDir')
$InstallDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($InstallDir)
function Get-RuntimeChecksum([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha256.Dispose() }
}
if ($Version) { $Release = "desktop-v$($Version.TrimStart('v'))" }
# Desktop currently publishes x64 Windows runtimes (also usable under ARM64 emulation).
if (-not $Target) { $Target = 'x86_64-pc-windows-msvc' }
if (($Release -or -not $Binary) -and $Release -notmatch '^desktop-(v\d+\.\d+\.\d+(-beta\.\d+)?|nightly-\d+)$') {
    throw 'Provide an exact desktop release tag with -Release or -Version'
}
if (-not $PSBoundParameters.ContainsKey('InstallDir')) {
    $existing = Get-Command cline -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing -and $existing.Source -and $existing.Source -ne (Join-Path $InstallDir 'cline.cmd')) {
        $manager = $null
        if ($existing.Source -like '*\.bun\*') { $manager = 'bun'; $removeArgs = @('remove', '-g', 'cline') }
        elseif ($existing.Source -like '*\npm\*' -or $existing.Source -like '*\node_modules\cline\*') { $manager = 'npm'; $removeArgs = @('uninstall', '-g', 'cline') }
        if ($manager) {
            Write-Host "Existing $manager installation: $($existing.Source). To remove it: $manager $($removeArgs -join ' ')"
            if (-not $ReplaceExisting -and -not [Console]::IsInputRedirected -and [Environment]::CommandLine -notmatch '-NonInteractive') {
                if ((Read-Host 'Remove this installation and install standalone? [y/N]') -match '^(y|yes)$') {
                    & $manager @removeArgs | Out-Host
                    if ($LASTEXITCODE -ne 0) { throw 'Package-manager uninstall failed' }
                    if (Test-Path $existing.Source) { throw 'The original CLI still exists; remove it with its owning package manager before retrying' }
                    $ReplaceExisting = $true
                }
            }
        } else { Write-Host "Existing CLI: $($existing.Source). Remove manually or use -ReplaceExisting to select standalone." }
    }
    if ($existing -and $existing.Source -and $existing.Source -ne (Join-Path $InstallDir 'cline.cmd') -and -not $ReplaceExisting) {
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
$activeRecord = Join-Path $InstallDir 'cline-runtime'
$entry = Join-Path $InstallDir $(if ($managedInstall) { 'cline.cmd' } else { "cline$extension" })
$releases = Join-Path $env:USERPROFILE '.cline\packages\standalone\releases'
$destination = Join-Path $InstallDir "cline$extension"
New-Item -ItemType Directory -Force $InstallDir | Out-Null
$lockDir = $InstallDir
if ($managedInstall) { New-Item -ItemType Directory -Force $releases | Out-Null; $lockDir = $releases }
$lock = $null
try {
    for ($attempt = 0; $attempt -lt 240; $attempt++) {
        try { $lock = [System.IO.File]::Open((Join-Path $lockDir '.install-lock'), 'OpenOrCreate', 'ReadWrite', 'None'); break }
        catch [System.IO.IOException] { Start-Sleep -Milliseconds 500 }
    }
    if (-not $lock) { throw 'Timed out waiting for another runtime installer' }
    if ($managedInstall) {
        if ($Target -notlike '*windows*') { throw 'Use -InstallDir for another machine' }
        if ((Test-Path $entry) -and (Get-Content $entry -First 1) -ne '@rem Cline standalone runtime') { throw "Refusing to replace unrelated file $entry" }
        if (Test-Path (Join-Path $InstallDir 'cline.exe')) { throw 'Remove the old standalone cline.exe before migrating to versioned releases' }
        New-Item -ItemType Directory -Force $releases | Out-Null
    }
    $stateDir = $InstallDir
    $cached = $false
    if ($managedInstall -and -not $Binary) {
        foreach ($candidate in Get-ChildItem $releases -Directory -Filter "$Release-$Target-*") {
            $candidateBinary = Join-Path $candidate.FullName "cline$extension"
            $candidateChecksum = "$candidateBinary.sha256"
            $candidateRelease = Join-Path $candidate.FullName 'release'
            if ((Test-Path $candidateBinary) -and (Test-Path $candidateChecksum) -and (Test-Path $candidateRelease) -and (Test-Path "$candidateBinary.build-epoch") -and
                (Get-Content "$candidateBinary.build-epoch" -Raw).Trim() -match '^\d+$' -and
                (Get-Content $candidateRelease -Raw).Trim() -eq "$Release/$Target" -and
                (Get-RuntimeChecksum $candidateBinary) -eq (Get-Content $candidateChecksum -Raw).Trim()) {
                $stateDir = $candidate.FullName; $cached = $true; break
            }
        }
    } elseif (-not $managedInstall) {
        $cached = -not $Binary -and (Test-Path $destination) -and (Test-Path "$destination.sha256") -and (Test-Path (Join-Path $InstallDir 'release')) -and (Test-Path "$destination.build-epoch")
        if ($cached) { $cached = (Get-Content "$destination.build-epoch" -Raw).Trim() -match '^\d+$' -and (Get-Content (Join-Path $InstallDir 'release') -Raw).Trim() -eq "$Release/$Target" -and (Get-RuntimeChecksum $destination) -eq (Get-Content "$destination.sha256" -Raw).Trim() }
    }
    $temporary = $null
    try {
        if (-not $cached) {
            $temporary = Join-Path $(if ($managedInstall) { $releases } else { $InstallDir }) ([Guid]::NewGuid().ToString())
            New-Item -ItemType Directory $temporary | Out-Null
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
            (Get-RuntimeChecksum $download) | Set-Content "$download.sha256"
            "$Release/$Target" | Set-Content (Join-Path $temporary 'release')
            "$expectedEpoch" | Set-Content "$download.build-epoch"
            $stateDir = $temporary
        }
        $selectedBinary = Join-Path $stateDir "cline$extension"
        $expectedEpoch = (Get-Content "$selectedBinary.build-epoch" -Raw).Trim()
        $installedEpoch = '0'
        if ($managedInstall -and (Test-Path $activeRecord)) {
            $active = @(Get-Content $activeRecord)
            if ($active.Count -ne 2 -or $active[0] -notmatch '^[a-zA-Z0-9._-]+$' -or $active[1] -notmatch '^\d+$') { throw 'Invalid active release metadata' }
            $installedEpoch = $active[1]
        } elseif (Test-Path "$destination.build-epoch") { $installedEpoch = (Get-Content "$destination.build-epoch" -Raw).Trim() }
        if (-not $managedInstall -and $Target -like '*windows*' -and (Test-Path $destination)) {
            try { $actualEpoch = (& $destination --runtime-build-epoch | Out-String).Trim(); if ($actualEpoch -match '^\d+$') { $installedEpoch = $actualEpoch } } catch { }
        }
        if ([long]$installedEpoch -gt [long]$expectedEpoch) { throw 'The installed CLI is newer; no downgrade was installed' }
        if ($managedInstall) {
            $expectedBuild = $env:CLINE_INSTALL_BUILD_ID
            if (-not $expectedBuild) {
                if ($Binary) { $expectedBuild = (& $Binary --runtime-build-id | Out-String).Trim() }
                elseif (Test-Path (Join-Path $stateDir 'build-id')) { $expectedBuild = (Get-Content (Join-Path $stateDir 'build-id') -Raw).Trim() }
                else { $expectedBuild = (Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/cline/cline/releases/download/$Release/cline-runtime-$Target$extension.build-id" -TimeoutSec 30).Content.Trim() }
            }
            $previousAutoUpdate = $env:CLINE_NO_AUTO_UPDATE
            try { $env:CLINE_NO_AUTO_UPDATE = '1'; $info = (& $selectedBinary --runtime-info | Out-String | ConvertFrom-Json) }
            finally { $env:CLINE_NO_AUTO_UPDATE = $previousAutoUpdate }
            if (-not $info.compiled -or -not $expectedBuild -or $info.buildId -ne $expectedBuild -or $info.target -ne $Target -or [long]$info.buildEpochMs -ne [long]$expectedEpoch) { throw 'Downloaded runtime identity does not match release metadata' }
            if (-not (Test-Path (Join-Path $stateDir 'build-id'))) { $expectedBuild | Set-Content (Join-Path $stateDir 'build-id') }
            $label = if ($Release) { $Release } else { 'local' }
            $selected = Join-Path $releases "$label-$Target-$(Get-RuntimeChecksum $selectedBinary)"
            if (-not $cached) {
                if (Test-Path $selected) {
                    $existingBinary = Join-Path $selected "cline$extension"
                    if (-not (Test-Path $existingBinary) -or (Get-RuntimeChecksum $existingBinary) -ne (Get-RuntimeChecksum $selectedBinary)) { throw 'Existing release directory is corrupt; remove it before retrying' }
                    foreach ($file in @("cline$extension.sha256", "cline$extension.build-epoch", 'release', 'build-id')) { Move-Item -Force (Join-Path $stateDir $file) (Join-Path $selected $file) }
                } else { Move-Item $temporary $selected; $temporary = $null }
            }
            $selectedName = Split-Path $selected -Leaf
            $activation = Join-Path $InstallDir ([Guid]::NewGuid().ToString() + '.active')
            $backup = "$activation.previous"
            try {
                [IO.File]::WriteAllText($activation, "$selectedName`r`n$expectedEpoch`r`n", [Text.Encoding]::ASCII)
                if (Test-Path $activeRecord) { [IO.File]::Replace($activation, $activeRecord, $backup) }
                else { [IO.File]::Move($activation, $activeRecord) }
                # The launcher stays unchanged during upgrades. It reads and closes
                # the active record before starting the selected executable.
                if (-not (Test-Path $entry)) {
                    [IO.File]::WriteAllText($entry, '@rem Cline standalone runtime' + "`r`n" +
                        '@echo off' + "`r`n" + 'setlocal DisableDelayedExpansion' + "`r`n" +
                        'set "CLINE_STANDALONE_RELEASE="' + "`r`n" +
                        'set /p "CLINE_STANDALONE_RELEASE="<"%~dp0cline-runtime"' + "`r`n" +
                        'if not defined CLINE_STANDALONE_RELEASE exit /b 1' + "`r`n" +
                        '"%USERPROFILE%\.cline\packages\standalone\releases\%CLINE_STANDALONE_RELEASE%\cline.exe" %*' + "`r`n" + 'exit /b %errorlevel%' + "`r`n", [Text.Encoding]::Default)
                }
            } finally { if (Test-Path $activation) { Remove-Item $activation }; if (Test-Path $backup) { Remove-Item $backup } }
            $destination = $entry
        } elseif (-not $cached) {
            # Explicit cross-target caches have no command launcher.
            foreach ($file in @("cline$extension.sha256", "cline$extension.build-epoch", 'release', "cline$extension")) {
                Move-Item -Force (Join-Path $temporary $file) (Join-Path $InstallDir $file)
            }
        }
    } finally { if ($temporary -and (Test-Path $temporary)) { Remove-Item -Recurse -Force $temporary } }
} finally { if ($lock) { $lock.Dispose() } }
if (-not $NoModifyPath) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($InstallDir -notin ($userPath -split ';')) {
        [Environment]::SetEnvironmentVariable('Path', "$InstallDir;$userPath", 'User')
    }
    Write-Host 'Open a new terminal to use cline.'
}
Write-Output $destination
