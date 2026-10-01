param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Add', 'Remove')]
    [string]$Action,
    [Parameter(Mandatory = $true)]
    [string]$InstallDir,
    [string]$EnvironmentKey = 'Environment',
    [string]$InstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\ClineCLI'
)

$ErrorActionPreference = 'Stop'

function Normalize-PathEntry([string]$Value) {
    $expanded = [Environment]::ExpandEnvironmentVariables($Value.Trim().Trim('"'))
    return $expanded.Replace('/', '\').TrimEnd('\')
}

# Read the raw registry value rather than the process PATH: the latter also
# contains the machine PATH and can expand or truncate the user's existing value.
$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
    [Microsoft.Win32.RegistryHive]::CurrentUser,
    [Microsoft.Win32.RegistryView]::Registry64
)
$environment = $null
$installation = $null
try {
    $binDir = Join-Path ([IO.Path]::GetFullPath($InstallDir)) 'bin'
    $normalizedBinDir = Normalize-PathEntry $binDir
    $environment = $registry.CreateSubKey($EnvironmentKey)
    $installation = $registry.CreateSubKey($InstallKey)
    $rawPath = $environment.GetValue(
        'Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
    )
    $pathExisted = $null -ne $rawPath
    $pathKind = [Microsoft.Win32.RegistryValueKind]::ExpandString
    if ($pathExisted) {
        $pathKind = $environment.GetValueKind('Path')
        if ($pathKind -ne [Microsoft.Win32.RegistryValueKind]::String -and
            $pathKind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) {
            throw 'The user PATH registry value is not a string.'
        }
    }

    $entries = @()
    if ($null -ne $rawPath -and $rawPath -ne '') {
        $entries = @(([string]$rawPath).Split(';'))
    }
    $matchingEntries = @($entries | Where-Object {
        [string]::Equals(
            (Normalize-PathEntry $_), $normalizedBinDir, [StringComparison]::OrdinalIgnoreCase
        )
    })

    if ($Action -eq 'Add') {
        if ($matchingEntries.Count -eq 0) {
            $newPath = $binDir
            if ($rawPath -ne $null -and $rawPath -ne '') {
                $newPath += ';' + [string]$rawPath
            }
            $environment.SetValue('Path', $newPath, $pathKind)
            $installation.SetValue('PathAdded', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
            $installation.SetValue('PathValueExisted', [int]$pathExisted, [Microsoft.Win32.RegistryValueKind]::DWord)
        } elseif ($null -eq $installation.GetValue('PathAdded', $null)) {
            # An entry that predates this installer belongs to the user.
            $installation.SetValue('PathAdded', 0, [Microsoft.Win32.RegistryValueKind]::DWord)
        }
        $installation.SetValue('PathEntry', $binDir, [Microsoft.Win32.RegistryValueKind]::String)
    } elseif ($installation.GetValue('PathAdded', 0) -eq 1) {
        $recordedEntry = [string]$installation.GetValue('PathEntry', '')
        if (-not [string]::Equals(
            (Normalize-PathEntry $recordedEntry), $normalizedBinDir, [StringComparison]::OrdinalIgnoreCase
        )) {
            throw 'The recorded Cline PATH entry does not match this installation.'
        }
        $remainingEntries = @($entries | Where-Object {
            -not [string]::Equals(
                (Normalize-PathEntry $_), $normalizedBinDir, [StringComparison]::OrdinalIgnoreCase
            )
        })
        $newPath = $remainingEntries -join ';'
        if ($newPath -eq '' -and $installation.GetValue('PathValueExisted', 1) -eq 0) {
            $environment.DeleteValue('Path', $false)
        } elseif ($matchingEntries.Count -gt 0) {
            $environment.SetValue('Path', $newPath, $pathKind)
        }
    }

    Write-Output 'User PATH updated.'
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($null -ne $environment) { $environment.Dispose() }
    if ($null -ne $installation) { $installation.Dispose() }
    $registry.Dispose()
}
