[CmdletBinding()]
param(
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $projectRoot "portable-release"
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules\.bin\vite.cmd"))) {
    throw "The local Vite executable is required to build the portable application."
}

Write-Host "Building without installer bundles..."
& (Join-Path $projectRoot "node_modules\.bin\vite.cmd") build
if ($LASTEXITCODE -ne 0) {
    throw "Renderer build failed with exit code $LASTEXITCODE."
}

$previousTauriConfig = $env:TAURI_CONFIG
$env:TAURI_CONFIG = '{"build":{"devUrl":null}}'
try {
    cargo build --release --manifest-path (Join-Path $projectRoot "src-tauri\Cargo.toml")
} finally {
    if ($null -eq $previousTauriConfig) {
        Remove-Item Env:TAURI_CONFIG -ErrorAction SilentlyContinue
    } else {
        $env:TAURI_CONFIG = $previousTauriConfig
    }
}
if ($LASTEXITCODE -ne 0) {
    throw "Portable executable build failed with exit code $LASTEXITCODE."
}

$exeCandidates = @(
    (Join-Path $projectRoot "src-tauri\target\release\cc-switch.exe"),
    (Join-Path $projectRoot "src-tauri\target\x86_64-pc-windows-msvc\release\cc-switch.exe")
)
$sourceExe = $exeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $sourceExe) {
    throw "The release executable was not found after the build."
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null

# Use a fresh staging directory so a running older portable EXE never blocks
# generation of the updated ZIP package.
$stagingDirectory = Join-Path $resolvedOutput (".Libra-Portable-staging-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stagingDirectory | Out-Null

try {
    Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $stagingDirectory "Libra.exe") -Force

    @(
        "# Libra portable build marker",
        "portable=true"
    ) | Set-Content -LiteralPath (Join-Path $stagingDirectory "portable.ini") -Encoding utf8

    $zipPath = Join-Path $resolvedOutput "Libra-Portable.zip"
    Compress-Archive -Path (Join-Path $stagingDirectory "*") -DestinationPath $zipPath -Force
    Write-Host "Portable package created: $zipPath"
} finally {
    if (Test-Path -LiteralPath $stagingDirectory) {
        Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
    }
}
