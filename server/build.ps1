param(
    [switch]$SkipBuild,
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'

$serverDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $serverDir
$distDir = Join-Path $repoRoot 'dist'
if (-not $OutDir) { $OutDir = Join-Path $serverDir 'bin' }

# 1. Build the Vue front end unless explicitly skipped
if (-not $SkipBuild) {
    Write-Host '> npm run build'
    Push-Location $repoRoot
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed: $LASTEXITCODE" }
    }
    finally {
        Pop-Location
    }
}

$indexFile = Join-Path $distDir 'index.html'
if (-not (Test-Path $indexFile)) { throw 'Missing dist/index.html. Run npm run build first.' }

# 2. Locate Visual Studio build tools
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { throw 'vswhere.exe not found. Visual Studio is required.' }
$vsPath = & $vswhere -latest -products * -property installationPath
if (-not $vsPath) { throw 'Visual Studio installation not found.' }
$vcvars = Join-Path $vsPath 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) { throw "vcvars64.bat not found: $vcvars" }

# 3. Prepare a temporary workspace
$workDir = Join-Path $serverDir '.build'
if (Test-Path $workDir) { Remove-Item $workDir -Recurse -Force }
New-Item -ItemType Directory -Path $workDir -Force | Out-Null
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$wwwDir = Join-Path $workDir 'www'
Copy-Item -Path $distDir -Destination $wwwDir -Recurse
Copy-Item -Path (Join-Path $serverDir 'SmtWebServer.cpp') -Destination $workDir
Copy-Item -Path (Join-Path $serverDir 'qrcodegen.hpp') -Destination $workDir
Copy-Item -Path (Join-Path $serverDir 'qrcodegen.cpp') -Destination $workDir

# 4. Generate the resource script and the asset table
$rc = New-Object System.Text.StringBuilder
$header = New-Object System.Text.StringBuilder
[void]$header.AppendLine('#pragma once')
[void]$header.AppendLine('struct EmbeddedAsset { const char* path; int id; };')
[void]$header.AppendLine('static const EmbeddedAsset kAssets[] = {')

$index = 0
Get-ChildItem -Path $wwwDir -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($wwwDir.Length).TrimStart('\', '/')
    $url = '/' + ($relative -replace '\\', '/')
    $id = 1000 + $index
    $index++
    [void]$rc.AppendLine(('{0} RCDATA "www/{1}"' -f $id, ($relative -replace '\\', '/')))
    [void]$header.AppendLine(('    {{ "{0}", {1} }},' -f $url, $id))
}

[void]$header.AppendLine('};')
[void]$header.AppendLine(('static const int kAssetCount = {0};' -f $index))

$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText((Join-Path $workDir 'assets.rc'), $rc.ToString(), $utf8Bom)
[System.IO.File]::WriteAllText((Join-Path $workDir 'assets_g.h'), $header.ToString(), $utf8Bom)

# 5. Compile with the Visual Studio toolchain
$outFile = Join-Path $OutDir 'smtweb.dll'
$batch = @(
    '@echo off',
    ('call "{0}" >nul' -f $vcvars),
    'if errorlevel 1 exit /b 1',
    'cd /d "%~dp0"',
    'rc /nologo /fo assets.res assets.rc',
    'if errorlevel 1 exit /b 1',
    'cl /nologo /utf-8 /LD /MT /O2 /EHsc /W3 /DNDEBUG /DUNICODE /D_UNICODE SmtWebServer.cpp qrcodegen.cpp assets.res /Fe:smtweb.dll /link /SUBSYSTEM:WINDOWS ws2_32.lib iphlpapi.lib user32.lib gdi32.lib',
    'if errorlevel 1 exit /b 1',
    'exit /b 0'
)
$batchFile = Join-Path $workDir 'build.bat'
[System.IO.File]::WriteAllLines($batchFile, $batch, (New-Object System.Text.ASCIIEncoding))

Write-Host '> rc + cl (x64)'
& cmd.exe /c "`"$batchFile`""
if ($LASTEXITCODE -ne 0) { throw "native build failed: $LASTEXITCODE" }

Copy-Item -Path (Join-Path $workDir 'smtweb.dll') -Destination $outFile -Force
Copy-Item -Path (Join-Path $serverDir 'smtweb.plugin.json') -Destination $OutDir -Force
$legacy = Join-Path $OutDir 'SmtWebServer.dll'
if (Test-Path $legacy) { Remove-Item $legacy -Force }
Remove-Item $workDir -Recurse -Force
Write-Host ('Built: ' + $outFile)
