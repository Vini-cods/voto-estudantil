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
# Only generic application resources belong in a new distribution.
$webAssets = @('index.html', 'app.js', 'style.css', 'favicon.svg', 'assets/gresp.png', 'assets/estado-sp.png')
foreach ($relativeAsset in $webAssets) {
    $targetAsset = Join-Path $buildDestination ('web/' + $relativeAsset)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetAsset) | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('src/web/' + $relativeAsset)) -Destination $targetAsset -Force
}
# Remove known retired files only inside this generated output; preserve source originals.
foreach ($retiredAsset in @('chapa-01-grupo.jpeg', 'chapa-07-grupo.jpeg', 'chapa-10-grupo.jpeg', 'chapa-07-representante.jpeg', 'chapa-10-representante.jpeg', 'gresp.jpeg', 'simbolo-institucional.jpeg', 'simbolo-institucional.png')) {
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
    Copy-Item -LiteralPath $standaloneFile -Destination (Join-Path $PSScriptRoot 'UrnaEstudantil.exe') -Force
    $releaseFile = Join-Path $releaseDirectory 'Voz-da-Escola.zip'
    # An explicit manifest prevents local data, old school photos and stray build files
    # from entering the ZIP, even when reusing an existing output directory.
    $packageFiles = @('UrnaEstudantil.exe', 'INICIAR.cmd', 'COMECE-AQUI.txt', 'LEIA-ME.html', 'Manual-de-uso.pdf', 'codigo-fonte/Program.cs', 'codigo-fonte/build.ps1', 'codigo-fonte/test_urna.py', 'codigo-fonte/LEIA-ME.txt', 'codigo-fonte/VALIDACAO.md')
    $packageFiles += $webAssets | ForEach-Object { 'web/' + $_ }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $releaseFile -PathType Leaf) { Remove-Item -LiteralPath $releaseFile -Force }
    $archive = [IO.Compression.ZipFile]::Open($releaseFile, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($relativeFile in $packageFiles) {
            $sourceFile = Join-Path $buildDestination $relativeFile
            if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { throw "Missing package file: $relativeFile" }
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $sourceFile, ('Voz-da-Escola/' + $relativeFile), [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $archive.Dispose() }
    # Keep the previously published download path as an identical compatibility alias.
    Copy-Item -LiteralPath $releaseFile -Destination (Join-Path $releaseDirectory 'Urna-Araci-Zebral.zip') -Force
    Write-Output $standaloneFile
    Write-Output $releaseFile
}
