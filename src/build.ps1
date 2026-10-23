param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\urna-build'),
    [string]$WebDirectory
)
$ErrorActionPreference = 'Stop'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Compilador .NET Framework não encontrado.' }
if (-not $WebDirectory) {
    $localWebDirectory = Join-Path $PSScriptRoot 'web'
    $WebDirectory = if (Test-Path -LiteralPath $localWebDirectory -PathType Container) { $localWebDirectory } else { Join-Path $PSScriptRoot '..\web' }
}
$webRoot = [System.IO.Path]::GetFullPath($WebDirectory)
$requiredAssets = @('index.html', 'app.js', 'style.css', 'favicon.svg', 'assets/gresp.png', 'assets/estado-sp.png')
$resourceArguments = @()
foreach ($relativePath in $requiredAssets) {
    $assetPath = Join-Path $webRoot $relativePath
    if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf) -or (Get-Item -LiteralPath $assetPath).Length -eq 0) { throw "Arquivo da interface ausente ou vazio: $relativePath" }
    $resourceArguments += "/resource:$assetPath,UrnaWeb/$relativePath"
}
$destination = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$executable = Join-Path $destination 'UrnaEstudantil.exe'
& $compiler /nologo /target:exe /optimize+ /platform:anycpu /codepage:65001 /reference:System.Web.Extensions.dll "/out:$executable" @resourceArguments (Join-Path $PSScriptRoot 'Program.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar a urna.' }
Write-Output $executable
