param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist\Urna-Araci-Zebral'),
    [switch]$Package
)
$ErrorActionPreference = 'Stop'
$buildDestination = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath (Join-Path $buildDestination 'Dados')) {
    throw 'This output contains election data. Choose another OutputDirectory; no data was changed.'
}
New-Item -ItemType Directory -Force -Path $buildDestination | Out-Null
& (Join-Path $PSScriptRoot 'src\build.ps1') -OutputDirectory $buildDestination
if ($LASTEXITCODE -ne 0) { throw 'Compilation failed.' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'src\web') -Destination $buildDestination -Recurse -Force
# Remove retired application assets from previously generated output folders.
foreach ($retiredAsset in @('chapa-07-representante.jpeg', 'chapa-10-representante.jpeg', 'gresp.jpeg', 'simbolo-institucional.jpeg')) {
    $retiredAssetPath = Join-Path $buildDestination ('web\assets\' + $retiredAsset)
    if (Test-Path -LiteralPath $retiredAssetPath -PathType Leaf) { Remove-Item -LiteralPath $retiredAssetPath -Force }
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'packaging\INICIAR.cmd'),(Join-Path $PSScriptRoot 'packaging\COMECE-AQUI.txt') -Destination $buildDestination -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'docs\LEIA-ME.html'),(Join-Path $PSScriptRoot 'docs\Manual-de-uso.pdf') -Destination $buildDestination -Force
$sourceDestination = Join-Path $buildDestination 'codigo-fonte'
New-Item -ItemType Directory -Force -Path $sourceDestination | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'src\Program.cs'),(Join-Path $PSScriptRoot 'src\build.ps1'),(Join-Path $PSScriptRoot 'tests\test_urna.py') -Destination $sourceDestination -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'docs\CODIGO-FONTE.txt') -Destination (Join-Path $sourceDestination 'LEIA-ME.txt') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'docs\VALIDACAO.md') -Destination (Join-Path $sourceDestination 'VALIDACAO.md') -Force
if ($Package) {
    $releaseDirectory = Join-Path $PSScriptRoot 'releases'
    New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
    $standaloneFile = Join-Path $releaseDirectory 'UrnaEstudantil.exe'
    Copy-Item -LiteralPath (Join-Path $buildDestination 'UrnaEstudantil.exe') -Destination $standaloneFile -Force
    $releaseFile = Join-Path $releaseDirectory 'Urna-Araci-Zebral.zip'
    Compress-Archive -LiteralPath $buildDestination -DestinationPath $releaseFile -CompressionLevel Optimal -Force
    Write-Output $standaloneFile
    Write-Output $releaseFile
}
