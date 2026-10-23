# Voz da Escola 2.0

Urna estudantil configurável para escolas, para **Windows 10/11 e Android 8 ou superior**. Funciona sem internet: um executável no Windows e um APK no Android. Cada aparelho guarda sua própria urna. Configurações e resultados podem ser transferidos entre as duas versões por arquivos JSON.

No primeiro uso, a escola informa seus dados e cadastra **de 2 a 12 chapas**, com nome, número único de dois dígitos, foto do grupo, representante, propostas e integrantes. Um logotipo pode ser adicionado. Depois de abrir a votação, a configuração fica bloqueada. O aluno informa nome e série/turma, digita os dois dígitos da chapa e confirma a escolha. Os votos ficam em contagens agregadas, com comparecimentos em uma lista separada.

## Android: APK para avaliação da Seduc

Baixe [Voz-da-Escola-Android.apk](releases/Voz-da-Escola-Android.apk). A equipe autorizada da Seduc deve avaliar o aplicativo e realizar a instalação conforme a gestão dos tablets. Requer Android 8 ou superior e Android System WebView/Chrome 80 ou superior. O APK funciona offline, sem permissão de internet, câmera ou acesso amplo aos arquivos.

O cadastro de chapas e a votação são os mesmos da versão Windows. Fotos, configurações e arquivos de resultados usam o seletor de arquivos do Android. Ao baixar um resultado, escolha o destino e conclua o salvamento. Os dados da urna ficam na área privada do app: **não desinstale nem use “Limpar dados” durante uma eleição**.

Após finalizar e exportar os arquivos, **Preparar nova eleição** arquiva uma única cópia final da eleição encerrada dentro do app e cria outra urna vazia. O arquivo interno não substitui as exportações guardadas pela escola. O fechamento não pode ser desfeito. A mesma configuração JSON pode ser usada em tablets e notebooks; os JSON finais podem ser somados em qualquer uma das versões.

Este APK tem assinatura local de avaliação. Preserve a chave local para atualizar a mesma instalação; a Seduc deverá definir uma assinatura institucional estável para distribuição e atualizações de produção. Não é uma publicação na Play Store. Consulte [o guia Android](docs/ANDROID.md), [o roteiro de validação](docs/ANDROID-VALIDACAO.md) e as limitações dos testes antes do uso real.

## Windows: usar o executável

Baixe [UrnaEstudantil.exe](releases/UrnaEstudantil.exe). Em cada notebook, crie uma pasta própria no disco local, copie apenas esse executável e abra-o, sem instalação ou extração.

Na primeira execução, o programa cria a pasta `Dados` ao lado do EXE. Ela guarda o estado dessa urna e deve permanecer ali. Para outro notebook, copie somente o EXE original, sem levar `Dados` de uma urna já iniciada. Ao atualizar o aplicativo na mesma pasta, substitua apenas o EXE e preserve `Dados`.

Na primeira execução, preencha **escola, título da eleição e nome da urna**, cadastre as chapas e confira as imagens. Use um nome diferente para cada notebook. **Exportar configuração** e **Importar configuração** compartilham os dados da eleição e das chapas, sem levar votos ou lista de presença. Confira o nome de cada urna e use **Abrir votação** somente depois de revisar o cadastro.

Atribua cada turma a um único notebook e anote essa distribuição. Ao retomar uma pasta existente, os dados e o estado da urna são preservados: votações abertas continuam abertas e as encerradas continuam encerradas.

Ao terminar, use **Finalizar votação**, marque a confirmação de encerramento definitivo e clique em **Finalizar e ver resultado**. O CSV para Excel é baixado automaticamente. Baixe também o JSON de cada notebook para **Somar urnas** nos resultados. Depois de encerrada, use **Ver resultados** para consultar e exportar a apuração.

Na tela inicial e nos detalhes da chapa, **Ampliar foto** mostra a imagem inteira do grupo. Use **Voltar à chapa** para retornar.

Consulte o [manual em HTML](docs/LEIA-ME.html) ou o [manual em PDF](docs/Manual-de-uso.pdf) para configurar, votar, finalizar e somar as urnas. O [ZIP completo opcional](releases/Voz-da-Escola.zip) reúne materiais de apoio, documentação e fontes. Para outra eleição, use o EXE em uma pasta nova, sem copiar `Dados` de uma eleição anterior.

## Distribuição de 680 alunos

Para 17 salas com 40 alunos e cinco notebooks, mantenha cada sala em uma só urna. Um exemplo de distribuição é:

| Notebook | Salas | Alunos previstos |
| --- | --- | ---: |
| 1 | 1 a 4 | 160 |
| 2 | 5 a 8 | 160 |
| 3 | 9 a 11 | 120 |
| 4 | 12 a 14 | 120 |
| 5 | 15 a 17 | 120 |
| **Total** | **17 salas** | **680** |

Associe esses grupos aos nomes reais das turmas e anote o nome e o identificador de cada urna. Depois do encerramento, reúna os cinco arquivos JSON em **Somar urnas**.

Para executar a simulação com dados fictícios em pastas temporárias:

```powershell
python tests/test_urna.py --exe releases/UrnaEstudantil.exe --capacity-smoke
```

## Compilar e verificar

Execute a partir da raiz do repositório, no PowerShell do Windows. A compilação usa o compilador do .NET Framework do Windows; Node.js e Python são necessários apenas para as verificações de desenvolvimento.

```powershell
powershell -File build.ps1 -Package
node --check src/web/app.js
python tests/test_urna.py --exe releases/UrnaEstudantil.exe --web-dir src/web
```

`src/Program.cs` e `src/web/` são as fontes oficiais. A compilação incorpora a interface no executável. O comando com `-Package` atualiza `releases/UrnaEstudantil.exe` e o ZIP completo opcional. `tests/` contém as verificações; `docs/`, os manuais; e `packaging/`, o iniciador de apoio `INICIAR.cmd` e o guia `COMECE-AQUI.txt`. Os distribuíveis devem acompanhar as alterações de código e conteúdo.

## Compilar e verificar o Android

Requer JDK 21, Android SDK com plataforma 36/build-tools 36.0.0 e Gradle 8.13. O plugin Android Gradle está fixado em 8.13.2. Nenhum SDK, cache ou chave privada é incluído no repositório.

```powershell
powershell -File build-android.ps1
node tests/test_android_bridge.js
python tests/android/run_android_tests.py --help
```

O script aceita caminhos de SDK, JDK e Gradle; consulte `Get-Help ./build-android.ps1 -Detailed`. Ele compila, verifica a assinatura e copia o APK para `releases/`. As fontes nativas estão em `src/android/`; os seis recursos da interface vêm diretamente de `src/web/`. Não altere cópias geradas. A chave de avaliação é gerada localmente em `src/android/.signing/`, que deve ficar fora do Git e ser preservada entre compilações. Não rode `clean` apagando essa pasta.

O manual em PDF é gerado a partir do HTML com `python tools/render_manual.py` (requer ReportLab). Confira todas as páginas renderizadas ao alterá-lo.

## Dados e limites

Dados e materiais de eleições reais ficam fora do versionamento: fotos e nomes de participantes, votos, listas de presença, relatórios, configurações preenchidas e credenciais. Use somente dados fictícios em testes e exemplos do programa.

Uma urna offline não impede, em tempo real, que um aluno tente votar em outro notebook. A escola deve conferir a identidade e atribuir cada turma a uma única urna. A consolidação valida os totais e detecta conflitos entre urnas. O aplicativo escolar não tem certificação do TSE; comparar cópias dos dados produzidas durante a votação pode permitir inferir escolhas. Preserve os arquivos sob controle da equipe da escola.
