<#
.SYNOPSIS
Compila e verifica o APK de avaliação Voz da Escola.
.DESCRIPTION
Requer JDK21, Gradle8.13, plataforma Android36 e Build-Tools36.0.0 instalados.
Não instala SDK, não aceita licenças e não publica ou instala o aplicativo.
A chave local fica em src/android/.signing/, fora do Git; preserve-a para atualizações.
.PARAMETER AndroidSdk
Pasta do SDK Android. Padrão: LOCALAPPDATA/Android/Sdk.
.PARAMETER JavaHome
Pasta do JDK21. Padrão: C:/Program Files/Java/jdk-21.
.PARAMETER GradleHome
Pasta do Gradle8.13. Padrão: work/android-tools/gradle-8.13.
.EXAMPLE
powershell -File build-android.ps1 -AndroidSdk C:/Android/Sdk -JavaHome C:/Java/jdk-21 -GradleHome C:/Gradle/gradle-8.13
#>
param(
    [string]$AndroidSdk,
    [string]$JavaHome,
    [string]$GradleHome
)

$ErrorActionPreference = 'Stop'

if (-not $AndroidSdk) {
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA não está definido. Informe -AndroidSdk com o SDK Android instalado.' }
    $AndroidSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}
if (-not $JavaHome) { $JavaHome = 'C:\Program Files\Java\jdk-21' }
if (-not $GradleHome) { $GradleHome = Join-Path $PSScriptRoot 'work\android-tools\gradle-8.13' }

$sdkDirectory = [IO.Path]::GetFullPath($AndroidSdk)
$jdkDirectory = [IO.Path]::GetFullPath($JavaHome)
$gradleDirectory = [IO.Path]::GetFullPath($GradleHome)
$androidProject = Join-Path $PSScriptRoot 'src\android'
$javaExecutable = Join-Path $jdkDirectory 'bin\java.exe'
$javacExecutable = Join-Path $jdkDirectory 'bin\javac.exe'
$keytoolExecutable = Join-Path $jdkDirectory 'bin\keytool.exe'
$gradleExecutable = Join-Path $gradleDirectory 'bin\gradle.bat'
$platformJar = Join-Path $sdkDirectory 'platforms\android-36\android.jar'
$buildToolsDirectory = Join-Path $sdkDirectory 'build-tools\36.0.0'
$apkSigner = Join-Path $buildToolsDirectory 'apksigner.bat'
$aaptExecutable = Join-Path $buildToolsDirectory 'aapt.exe'

foreach ($jdkTool in @($javaExecutable, $javacExecutable, $keytoolExecutable)) {
    if (-not (Test-Path -LiteralPath $jdkTool -PathType Leaf)) {
        throw 'JDK não encontrado ou incompleto. Instale o JDK 21 ou informe -JavaHome com a pasta de instalação.'
    }
}
if (-not (Test-Path -LiteralPath $gradleExecutable -PathType Leaf)) {
    throw 'Gradle não encontrado. Disponibilize o Gradle 8.13 em work/android-tools/gradle-8.13 ou informe -GradleHome.'
}
foreach ($sdkTool in @($platformJar, $apkSigner, $aaptExecutable)) {
    if (-not (Test-Path -LiteralPath $sdkTool -PathType Leaf)) {
        throw 'SDK Android incompleto. Instale a plataforma Android 36 e Build-Tools 36.0.0, ou informe -AndroidSdk. Este script não baixa SDKs nem aceita licenças.'
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $androidProject 'app\build.gradle') -PathType Leaf)) {
    throw 'Projeto Android não encontrado em src/android.'
}

$previousJavaHome = $env:JAVA_HOME
$previousAndroidHome = $env:ANDROID_HOME
$previousAndroidSdkRoot = $env:ANDROID_SDK_ROOT
$previousExecutablePath = $env:PATH
$temporaryApk = $null

try {
    $env:JAVA_HOME = $jdkDirectory
    $env:ANDROID_HOME = $sdkDirectory
    $env:ANDROID_SDK_ROOT = $sdkDirectory
    $env:PATH = (Join-Path $jdkDirectory 'bin') + [IO.Path]::PathSeparator + $previousExecutablePath

    # The installed SDK is mandatory; SDK installation and licence acceptance are external steps.
    & $gradleExecutable -p $androidProject assembleDebug --no-daemon --console plain '-Pandroid.builder.sdkDownload=false'
    if ($LASTEXITCODE -ne 0) { throw 'A compilação do APK falhou. Nenhum APK de distribuição foi substituído.' }

    $builtApk = Join-Path $androidProject 'app\build\outputs\apk\debug\app-debug.apk'
    if (-not (Test-Path -LiteralPath $builtApk -PathType Leaf)) { throw 'O Gradle não gerou o APK esperado.' }

    & $apkSigner verify --verbose $builtApk
    if ($LASTEXITCODE -ne 0) { throw 'A verificação da assinatura do APK falhou. Nenhum APK de distribuição foi substituído.' }

    $badging = & $aaptExecutable dump badging $builtApk
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível verificar os metadados do APK.' }
    $badgingText = $badging -join "`n"
    if ($badgingText -notmatch "package:\s+name='br\.escola\.vozdaescola\.urna'") {
        throw 'O APK gerado não pertence ao aplicativo Voz da Escola.'
    }
    if ($badgingText -notmatch "sdkVersion:'26'") { throw 'O APK não informa a versão mínima Android 8 / API 26 esperada.' }
    Write-Output $badgingText

    $releaseDirectory = Join-Path $PSScriptRoot 'releases'
    New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
    $distributionApk = Join-Path $releaseDirectory 'Voz-da-Escola-Android.apk'
    $temporaryApk = Join-Path $releaseDirectory ('.Voz-da-Escola-Android-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    Copy-Item -LiteralPath $builtApk -Destination $temporaryApk
    $expectedHash = (Get-FileHash -LiteralPath $builtApk -Algorithm SHA256).Hash
    if ((Get-FileHash -LiteralPath $temporaryApk -Algorithm SHA256).Hash -ne $expectedHash) {
        throw 'A cópia do APK não passou na conferência SHA-256.'
    }
    if (Test-Path -LiteralPath $distributionApk -PathType Leaf) {
        [IO.File]::Replace($temporaryApk, $distributionApk, [NullString]::Value)
    } else {
        [IO.File]::Move($temporaryApk, $distributionApk)
    }
    $temporaryApk = $null
    Write-Output $distributionApk
    Write-Output ('SHA256=' + $expectedHash)
} finally {
    if ($temporaryApk -and (Test-Path -LiteralPath $temporaryApk -PathType Leaf)) {
        Remove-Item -LiteralPath $temporaryApk -Force -ErrorAction SilentlyContinue
    }
    $env:JAVA_HOME = $previousJavaHome
    $env:ANDROID_HOME = $previousAndroidHome
    $env:ANDROID_SDK_ROOT = $previousAndroidSdkRoot
    $env:PATH = $previousExecutablePath
}
