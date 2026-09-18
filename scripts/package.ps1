$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginName = 'typora-reference-manager'
$manifest = Get-Content -LiteralPath (Join-Path $repoRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') {
    throw 'Invalid manifest version'
}
$files = @('main.js', 'manifest.json', 'style.css')
foreach ($name in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $name) -PathType Leaf)) {
        throw "Missing package file: $name"
    }
}
$outputDir = Join-Path $repoRoot 'release'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$archiveName = "$pluginName-v$($manifest.version).zip"
$archivePath = Join-Path $outputDir $archiveName
if (Test-Path -LiteralPath $archivePath) {
    throw "Archive already exists: $archivePath. Move it aside before rebuilding."
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($archivePath, 'Create')
try {
    foreach ($name in $files) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, (Join-Path $repoRoot $name), "$pluginName/$name",
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally {
    $archive.Dispose()
}
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText("$archivePath.sha256", "$hash  $archiveName`n", [System.Text.UTF8Encoding]::new($false))
Write-Output "Created $archivePath"
Write-Output "SHA256 $hash"
