# Validação Android - Voz da Escola 2.0

Registro de desenvolvimento de 23/10/2026. Todos os testes usam dados fictícios em diretórios temporários; nenhuma urna escolar foi aberta ou modificada.

## Verificações executadas

- Compilação Android com JDK 21.0.8, Gradle 8.13, Android Gradle Plugin 8.13.2, plataforma Android 36 e Build-Tools 36.0.0.
- Assinatura do APK verificada com `apksigner verify --verbose`, esquema v2 válido. Trata-se da variante de avaliação `debug`, com depuração habilitada e chave local fora do Git.
- Manifesto compilado: pacote `br.escola.vozdaescola.urna`, versão 2.0 / código 20000, mínimo API 26, alvo API 36, sem permissões de internet/câmera/armazenamento e com backup desativado.
- Conferência dos seis recursos genéricos empacotados contra os bytes atuais de `src/web/`; ausência de fotos de chapas reais e dados de eleição no APK.
- Suíte Java do armazenamento: configuração vazia, duas e doze candidaturas, todas as escolhas, validações, congelamento após abertura, CSRF/sessões, gravação atômica, bloqueio exclusivo, retomada, prevenção de replay e duplicidades, fechamento, CSV e contagens exatas.
- Novo ciclo: somente depois de encerrar e confirmar, arquivo final único preservado, recusa de colisão diferente, repetição segura de arquivo idêntico, novo identificador e zero votos; sessões anteriores invalidadas.
- Arquivos corrompidos, JSON profundo/cíclico e controles inválidos são recusados sem substituir os dados; o bloqueio permanece consistente.
- Intercâmbio real entre os motores Windows e Android em urnas fictícias: mesmo identificador de eleição, identificadores de urna distintos e soma exata de quatro votos nos dois lados, incluindo branco e nulo. Exportações repetidas, eleições incompatíveis e alunos repetidos são recusados.
- Teste JavaScript da ponte: roteamento Android, UTF-8, erros, cancelamento, espera pelo salvamento efetivo e preservação do transporte HTTP no Windows.
- Compilação e suíte de integração Windows completas após a adaptação da interface compartilhada.
- Após incluir os limites físicos dos diálogos e alternativas em `vh` para WebView 80/83, recompilação Windows, sintaxe JavaScript, teste da ponte e suíte Windows completas passaram. Os dois ZIPs oficiais foram regenerados e conferidos: 16 arquivos previstos, recursos web idênticos às fontes atuais e ausência de dados de eleição.
- Manual atualizado para cinco páginas, renderizado com Poppler e PDFium e conferido visualmente. PDFium foi usado para confirmar falhas de renderização de fontes no Poppler local.

## Execução Android e limites

O APK de avaliação foi instalado e aberto em um emulador AOSP Android 11 (API 30), com WebView 83.0.4103.120. A atividade `MainActivity` ficou em primeiro plano (`resumed`) e uma captura do próprio aplicativo confirmou a tela inicial de personalização legível. A janela de espelhamento foi aberta com scrcpy 5.0.1 e renderização por software.

O driver AEHD 2.2 foi instalado com autorização do usuário e ficou utilizável. O computador tem 4 GB de RAM; o emulador foi iniciado com `-lowram -memory 1536` e apresentou bastante lentidão. Houve um aviso inicial de aplicativo sem resposta do SystemUI do Android; após escolher Aguardar, o aviso desapareceu. O emulador também reiniciou serviços ao retomar uma pausa, interrompendo uma tentativa de atualização do APK.

**O ensaio gráfico cobriu instalação, abertura e a tela inicial de personalização. Ainda não foi realizado um ciclo completo de votação e exportação no Android, nem um teste em tablet físico da Seduc.**

Ainda precisam ser ensaiados pela TI da Seduc, no modelo de tablet e na política de gestão usados: instalação, abertura, teclado, foto pelo seletor, votação completa, rotação, retomada após fechar, salvamento/cancelamento de CSV/JSON, impressão/PDF e atualização preservando dados. Os testes de lógica e a verificação da assinatura não substituem esse ensaio.

Para distribuição de produção, a instituição deve definir e proteger sua assinatura permanente e o processo de atualizações. Não desinstale uma urna com dados para contornar incompatibilidade de assinatura.

## Repetir as verificações

Na raiz, com as dependências instaladas:

```powershell
powershell -File build.ps1 -Package
node --check src/web/app.js
node tests/test_android_bridge.js
python tests/test_urna.py --exe dist/Urna-Araci-Zebral/UrnaEstudantil.exe --web-dir src/web
powershell -File build-android.ps1
python tests/android/run_android_tests.py --json-jar C:/caminho/json-20250517.jar --exe releases/UrnaEstudantil.exe --apk releases/Voz-da-Escola-Android.apk
```

O ensaio JVM usa o JAR `org.json:json:20250517` apenas no desenvolvimento; o Android usa `org.json` do próprio sistema. Os caminhos de `java`, `javac` e `aapt` podem ser informados por parâmetros ao teste. O script cria e remove suas pastas temporárias e encerra o processo Windows usado no intercâmbio. Não aponte os testes para diretórios de urnas reais.

Fontes técnicas: [conteúdo local em WebView](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content), [Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files), [assinatura de aplicativos](https://developer.android.com/studio/publish/app-signing).

## Identificação do APK conferido

SHA-256: `29861633b7229d347cfed7f5f5a24ce3de21df4ab5b699665e9e2045c758a724`.
