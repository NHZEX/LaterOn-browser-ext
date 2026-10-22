#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $Archive,
    [Parameter(Mandatory)][string] $Destination
)

$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($Destination).TrimEnd([IO.Path]::DirectorySeparatorChar)
$parent = [IO.Path]::GetDirectoryName($target)
$leaf = [IO.Path]::GetFileName($target)
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $parent -or -not $leaf) { throw 'Destination must name an extension directory' }
if ($projectRoot.Equals($target, [StringComparison]::OrdinalIgnoreCase) -or
    $projectRoot.StartsWith($target + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Cannot replace the project directory or its ancestors'
}
if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw "Destination parent does not exist: $parent" }

function Assert-ChildPath([string] $candidate, [string] $directory) {
    if (-not $candidate.StartsWith($directory.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escapes intended directory: $candidate"
    }
}

function Get-Inventory([string] $directory) {
    @(Get-ChildItem -LiteralPath $directory -Recurse -File -Force | ForEach-Object {
        $relative = [IO.Path]::GetRelativePath($directory, $_.FullName).Replace('\', '/')
        $relative + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    } | Sort-Object)
}

function Assert-Inventory([string] $directory, [string[]] $expected) {
    $actual = @(Get-Inventory $directory)
    if (@(Compare-Object -ReferenceObject $expected -DifferenceObject $actual).Count -ne 0) {
        throw "File/hash mismatch: $directory"
    }
}

Assert-ChildPath $target $parent
$archivePath = (Resolve-Path -LiteralPath $Archive).Path
$package = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $expected = @($package.Entries | ForEach-Object {
        if ($_.FullName -match '(^/|\\|(^|/)\.\.(/|$)|:)' -or $_.FullName.EndsWith('/')) {
            throw "Invalid package entry: $($_.FullName)"
        }
        $stream = $_.Open()
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $_.FullName + ':' + [Convert]::ToHexString($hasher.ComputeHash($stream)) }
        finally {
            $hasher.Dispose()
            $stream.Dispose()
        }
    } | Sort-Object)
    if (-not $expected.Count -or @($package.Entries.FullName | Sort-Object -Unique).Count -ne $expected.Count) {
        throw 'Empty package or duplicate entries'
    }
    $manifestEntry = $package.GetEntry('manifest.json')
    if (-not $manifestEntry) { throw 'Package has no manifest.json' }
    $reader = [IO.StreamReader]::new($manifestEntry.Open())
    try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json }
    finally { $reader.Dispose() }
} finally { $package.Dispose() }
if ($manifest.manifest_version -ne 3 -or -not $manifest.version) { throw 'Expected a versioned MV3 package' }

$exists = Test-Path -LiteralPath $target
if ($exists) {
    if (-not (Test-Path -LiteralPath $target -PathType Container) -or
        ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Existing destination must be a normal directory'
    }
    $oldManifest = Get-Content -LiteralPath (Join-Path $target 'manifest.json') -Raw | ConvertFrom-Json
    if (-not $oldManifest.version -or $oldManifest.name -ne $manifest.name) {
        throw 'Existing directory is not the same extension'
    }
    $oldInventory = @(Get-Inventory $target)
    if (@(Compare-Object -ReferenceObject $expected -DifferenceObject $oldInventory).Count -eq 0) {
        Write-Output "Already installed: $target ($($manifest.version), $($expected.Count) files, SHA-256 verified)"
        return
    }
}

$token = [guid]::NewGuid().ToString('N').Substring(0, 8)
$stage = [IO.Path]::GetFullPath((Join-Path $parent ('.' + $leaf + '-stage-' + $token)))
$backupRoot = [IO.Path]::GetFullPath((Join-Path $parent ($leaf + '-backups')))
Assert-ChildPath $stage $parent
Assert-ChildPath $backupRoot $parent
if (Test-Path -LiteralPath $stage) { throw 'Staging directory already exists' }
Expand-Archive -LiteralPath $archivePath -DestinationPath $stage
Assert-Inventory $stage $expected

$archived = $false
$installed = $false
try {
    if ($exists) {
        $backup = [IO.Path]::GetFullPath((Join-Path $backupRoot ($oldManifest.version + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $token)))
        Assert-ChildPath $backup $backupRoot
        if (Test-Path -LiteralPath $backup) { throw 'Backup directory already exists' }
        [void](New-Item -ItemType Directory -Path $backupRoot -Force)
        Move-Item -LiteralPath $target -Destination $backup
        $archived = $true
        Assert-Inventory $backup $oldInventory
    }
    Move-Item -LiteralPath $stage -Destination $target
    $installed = $true
    Assert-Inventory $target $expected
} catch {
    if ($installed) { Move-Item -LiteralPath $target -Destination $stage }
    if ($archived -and -not (Test-Path -LiteralPath $target)) {
        Move-Item -LiteralPath $backup -Destination $target
    }
    throw
}

Write-Output "Published: $target ($($manifest.version), $($expected.Count) files, SHA-256 verified against ZIP)"
if ($archived) { Write-Output "Backup: $backup (old files and SHA-256 verified)" }
