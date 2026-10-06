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
if ($Version) { $Release = "desktop-v$($Version.TrimStart('v'))" }
# Desktop currently publishes x64 Windows runtimes (also usable under ARM64 emulation).
if (-not $Target) { $Target = 'x86_64-pc-windows-msvc' }
if (-not $Binary -and $Release -notmatch '^desktop-(v\d+\.\d+\.\d+(-beta\.\d+)?|nightly-\d+)$') {
    throw 'Provide an exact desktop release tag with -Release or -Version'
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
        $cached = (Get-Content $releasePath -Raw).Trim() -eq "$Release/$Target" -and (Get-FileHash $destination -Algorithm SHA256).Hash -eq (Get-Content $checksumPath -Raw).Trim()
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
                if ((Get-FileHash $download -Algorithm SHA256).Hash -ne $expected) { throw 'Runtime checksum mismatch' }
            }
            # No replacement of a running CLI: each desktop release has its own cache.
            Move-Item -Force $download $destination
            (Get-FileHash $destination -Algorithm SHA256).Hash | Set-Content $checksumPath
            "$Release/$Target" | Set-Content $releasePath
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
