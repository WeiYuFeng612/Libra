[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [string]$ZipPath
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$projectsDirectory = Split-Path -Parent $projectRoot

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $projectsDirectory "Libra-GitHub"
}
if ([string]::IsNullOrWhiteSpace($ZipPath)) {
    $ZipPath = Join-Path $projectsDirectory "Libra-1.0.0-source.zip"
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
$resolvedZip = [System.IO.Path]::GetFullPath($ZipPath)
if ($resolvedOutput.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputDirectory must be outside the project root."
}

$excludedTopLevelDirectories = @(
    ".git",
    ".idea",
    ".vscode",
    ".worktrees",
    "dist",
    "node_modules",
    "nul",
    "portable-release",
    "release"
)
$excludedRelativeDirectories = @("src-tauri\target")
$excludedFileNames = @(".env", ".env.local", "nul", "vitest-report.json")

$stagingDirectory = $resolvedOutput + ".staging-" + [guid]::NewGuid().ToString("N")
New-Item -ItemType Directory -Path $stagingDirectory | Out-Null

try {
    $directories = [System.Collections.Generic.Queue[System.IO.DirectoryInfo]]::new()
    $directories.Enqueue((Get-Item -LiteralPath $projectRoot))

    while ($directories.Count -gt 0) {
        $directory = $directories.Dequeue()
        foreach ($item in Get-ChildItem -LiteralPath $directory.FullName -Force) {
            $relativePath = $item.FullName.Substring($projectRoot.Length).TrimStart([char[]]"\/")
            $segments = $relativePath -split "[\\/]"
            $topLevel = $segments[0]

            if ($item.PSIsContainer) {
                $isExcludedDirectory =
                    $excludedTopLevelDirectories -contains $topLevel -or
                    ($excludedRelativeDirectories | Where-Object {
                        $relativePath -eq $_ -or $relativePath.StartsWith($_ + "\", [System.StringComparison]::OrdinalIgnoreCase)
                    })
                if (-not $isExcludedDirectory) {
                    $directories.Enqueue($item)
                }
                continue
            }

            $isExcludedFile =
                $excludedFileNames -contains $item.Name -or
                $item.Extension -in @(".log", ".tsbuildinfo")
            if ($isExcludedFile) {
                continue
            }

            $destination = Join-Path $stagingDirectory $relativePath
            $destinationParent = Split-Path -Parent $destination
            New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
            Copy-Item -LiteralPath $item.FullName -Destination $destination -Force
        }
    }

    if (Test-Path -LiteralPath $resolvedOutput) {
        Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
    }
    Move-Item -LiteralPath $stagingDirectory -Destination $resolvedOutput

    $zipParent = Split-Path -Parent $resolvedZip
    New-Item -ItemType Directory -Force -Path $zipParent | Out-Null
    Compress-Archive -Path (Join-Path $resolvedOutput "*") -DestinationPath $resolvedZip -Force

    $files = Get-ChildItem -LiteralPath $resolvedOutput -Recurse -File -Force
    $totalBytes = ($files | Measure-Object Length -Sum).Sum
    Write-Host "GitHub source directory: $resolvedOutput"
    Write-Host "Source ZIP: $resolvedZip"
    Write-Host ("Files: {0}; source size: {1:N2} MB" -f $files.Count, ($totalBytes / 1MB))
} finally {
    if (Test-Path -LiteralPath $stagingDirectory) {
        Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
    }
}
