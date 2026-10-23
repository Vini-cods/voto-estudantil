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
- Manual atualizado para cinco páginas, renderizado com Poppler e PDFium e conferido visualmente. PDFium foi usado para confirmar falhas de renderização de fontes no Poppler local.

## Limitação de execução Android

**O APK não foi executado em tablet físico nem em emulador funcional.** O computador não tem o driver de aceleração do emulador. Uma tentativa isolada, sem aceleração, encerrou antes de iniciar o Android, com avisos de recursos de CPU não suportados e término do renderizador. Não foram instalados drivers, alteradas proteções do Windows ou acessados aparelhos reais.

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

SHA-256: `e98bcac5b98f869e89abe976f2364549be98ea59a81826ce78f2ea03faf1b855`.
