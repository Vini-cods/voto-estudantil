# Instruções para trabalhar neste repositório

## Escopo e fontes oficiais

- Este é o projeto **Voz da Escola — Urna Estudantil**, para Windows e uso offline.
- Trabalhe na raiz deste repositório. As fontes oficiais são `src/Program.cs`, `src/build.ps1` e `src/web/`; `build.ps1`, na raiz, coordena a compilação e o empacotamento.
- Não faça correções apenas em cópias compiladas ou extraídas do pacote. Altere as fontes, valide e regenere os artefatos necessários.
- Preserve nomes, números, propostas e imagens fornecidos pelo usuário. Mantenha os números de dois dígitos, incluindo zeros iniciais.
- Pyetro, do 2º ano D, e Pyetro Wilians, do 1º ano A, são pessoas distintas na chapa 10.

## Dados do usuário e privacidade

- Preserve alterações existentes do usuário. Antes de editar, confira `git status` e os diffs pertinentes; não sobrescreva trabalho não relacionado à solicitação.
- Nunca versione dados de eleição real: pastas `Dados` ou `Datos`, `urna.json`, cópias de dados, listas de presença, votos, relatórios reais ou exportações de urnas.
- Nunca versione PINs reais, senhas, tokens, credenciais, arquivos de autenticação, perfis de navegador, logs ou arquivos temporários. Fixtures de teste devem ser sintéticas e isoladas.
- O repositório é privado e contém nomes e fotos das chapas. Não o torne público nem publique os materiais em serviços externos sem autorização específica.
- Não abra ou modifique uma urna real para executar testes. Use diretórios temporários e preserve todos os dados existentes.
- Não crie backups automáticos sucessivos dos dados de votação: comparações de versões podem associar comparecimentos a mudanças nas contagens.

## Validação e distribuição

- Execute a partir da raiz, em Windows:

  ```powershell
  powershell -File build.ps1 -Package
  node --check src/web/app.js
  python tests/test_urna.py --exe dist/Urna-Araci-Zebral/UrnaEstudantil.exe --web-dir src/web
  ```

- Use verificações adequadas à mudança. Registre limitações e falhas reais; não declare que um teste passou sem executá-lo.
- Atualize `docs/LEIA-ME.html`, `docs/Manual-de-uso.pdf` e os guias em `packaging/` quando a operação mudar. Preserve impressão legível e confira o PDF quando alterar sua fonte.
- Quando alterar código, conteúdo ou imagens distribuídos, regenere `releases/Urna-Araci-Zebral.zip` a partir das fontes atuais, incluindo o executável e os arquivos web necessários.
- O ZIP deve estar pronto para a primeira execução: sem `Dados`, PIN, votos, listas de presença, logs, perfis de navegador ou arquivos de teste. Confira seu conteúdo antes de versionar.

## Commits e envio ao GitHub

- O usuário autorizou commits e envio normal ao GitHub após cada entrega relevante deste projeto. Ao concluir trabalho solicitado, prepare um commit claro e faça push para o remoto e a branch de trabalho corretos, sem repetir pedidos de confirmação para esse fluxo já autorizado. Isso não autoriza criar automações em segundo plano.
- O remoto esperado é o repositório privado `Vini-cods/urna-estudantil-araci-zebral`. Confirme o remoto configurado; não troque de conta ou publique outro repositório por suposição.
- Confira `git status`, o remoto e a branch antes de agir. Inspecione o diff completo e os arquivos que serão enviados.
- Adicione arquivos por caminhos explícitos. Não use `git add .` nem `git add -A`; não inclua trabalho alheio ou dados sensíveis por conveniência.
- Mantenha fonte, documentação e pacote distribuível coerentes no commit quando a mudança exigir esses artefatos.
- Use commits com descrição concreta da mudança e informe o que foi validado.
- Não use force push, não reescreva histórico publicado e não execute comandos destrutivos para limpar o trabalho do usuário. Se houver divergência remota, preserve as alterações e resolva o conflito com cuidado.
- Se autenticação, permissão ou conflito impedir o push, preserve o trabalho local e relate exatamente o impedimento. Nunca exponha tokens ou credenciais na saída.
