$ErrorActionPreference = 'Stop'
$version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
$releaseRoot = Join-Path (Get-Location).Path 'release'
$qaRoot = Join-Path (Get-Location).Path 'test-results/polish-native'
$productionExe = 'src-tauri/target/release/kuraudio.exe'
$binary = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $productionExe)))
if (!$binary.Contains('id.kuraudio.desktop') -or $binary.Contains('id.kuraudio.polishqa')) { throw 'Wrong production identifier' }
if ((Get-Item -LiteralPath $productionExe).VersionInfo.ProductVersion -notlike "$version*") { throw 'Wrong product version' }
$frontend = Get-Content -LiteralPath (Join-Path $qaRoot 'qa-frontend.json') -Raw | ConvertFrom-Json
foreach ($entry in $frontend) {
    if ((Get-FileHash -LiteralPath $entry.path).Hash -ne $entry.sha256) { throw "Frontend differs from native QA: $($entry.path)" }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Join-Path $releaseRoot "KurAudio-$version-source.zip"))
try {
    $checked = 0
    foreach ($entry in $archive.Entries) {
        $relative = $entry.FullName.Replace('\','/')
        if (!$entry.Name -or !(Test-Path -LiteralPath $relative -PathType Leaf)) { continue }
        $stream = $entry.Open()
        try { $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) } finally { $stream.Dispose() }
        if ($hash -ne (Get-FileHash -LiteralPath $relative).Hash) { throw "Stale packaged source: $relative" }
        $checked++
    }
    foreach ($required in 'src/App.tsx','src/audio.ts','src/CommitTextField.tsx','src/shortcutPolicy.ts','src/draftInput.ts','src/studio7.css','design-tokens.json','docs/AUDIT-0.11.0.md','docs/AUDIT-INTERFACE-2026-10-30.md','public/appearance-init.js') {
        if (!($archive.Entries | Where-Object { $_.FullName.Replace('\','/') -eq $required })) { throw "Missing packaged source: $required" }
    }
} finally { $archive.Dispose() }
$portable = "release/KurAudio-$version-windows/KurAudio.exe"
if ((Get-FileHash -LiteralPath $portable).Hash -ne (Get-FileHash -LiteralPath $productionExe).Hash) { throw 'Portable differs from production executable' }
if ((Get-FileHash -LiteralPath "release/KurAudio-$version-windows/third-party/relink/KurAudio-source.zip").Hash -ne (Get-FileHash -LiteralPath "release/KurAudio-$version-source.zip").Hash) { throw 'Portable source archive is stale' }
$portableArchive = [IO.Compression.ZipFile]::OpenRead((Join-Path $releaseRoot "KurAudio-$version-windows.zip"))
try {
    $exeEntry = @($portableArchive.Entries | Where-Object { $_.FullName.Replace('\','/') -eq 'KurAudio.exe' })
    if ($exeEntry.Count -ne 1) { throw 'Portable ZIP must contain exactly one root KurAudio.exe' }
    $stream = $exeEntry[0].Open()
    try { $zipExeHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) } finally { $stream.Dispose() }
    if ($zipExeHash -ne (Get-FileHash -LiteralPath $productionExe).Hash) { throw 'Zipped executable differs from production build' }
} finally { $portableArchive.Dispose() }
$installerScript = Get-Content -LiteralPath 'src-tauri/target/release/nsis/x64/installer.nsi' -Raw
foreach ($name in 'LGPL-3.0.txt','GPL-3.0.txt','upstream-source-1.2.7.zip','KurAudio-source.zip') { if (!$installerScript.Contains($name)) { throw "Installer resource missing: $name" } }
$artifacts = @($portable,"release/KurAudio-$version-x64-setup.exe","release/KurAudio-$version-windows.zip","release/KurAudio-$version-source.zip") | ForEach-Object {
    [ordered]@{path=$_;bytes=(Get-Item -LiteralPath $_).Length;sha256=(Get-FileHash -LiteralPath $_).Hash}
}
$artifacts | ForEach-Object { "$($_.sha256)  $($_.path)" } | Set-Content -LiteralPath "release/SHA256SUMS-$version.txt"
[ordered]@{version=$version;sourceFilesChecked=$checked;frontendMatchesNativeQa=$true;artifacts=$artifacts} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $qaRoot 'release-verification.json')
Write-Output "PASS release $version : $checked source files, frontend, identifiers, resources and artifact hashes"
