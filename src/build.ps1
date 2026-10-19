param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\urna-build'))
$ErrorActionPreference = 'Stop'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Compilador .NET Framework não encontrado.' }
$destination = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$executable = Join-Path $destination 'UrnaEstudantil.exe'
& $compiler /nologo /target:exe /optimize+ /platform:anycpu /codepage:65001 /reference:System.Web.Extensions.dll "/out:$executable" (Join-Path $PSScriptRoot 'Program.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar a urna.' }
Write-Output $executable
