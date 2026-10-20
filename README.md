# Voz da Escola — Urna Estudantil

Aplicativo portátil para a eleição do grêmio da escola **Araci Zebral Teixeira**, em notebooks com **Windows 10 ou 11**. Funciona sem internet em um único executável C#/.NET Framework, com interface, fotos e logotipos incorporados. Ele abre a interface local no navegador. Cada notebook guarda uma urna independente; um pendrive permite distribuir o executável e reunir os resultados ao final.

O aluno informa nome e série/turma, digita os dois dígitos da chapa e confirma a escolha. A interface destaca uma foto do grupo de cada chapa, com o nome da representante, propostas e integrantes. Ao finalizar a votação, o programa disponibiliza CSV para Excel, JSON para consolidação e relatório para impressão/PDF. O sistema mantém contagens agregadas e uma lista de comparecimento separada, sem relatório de voto por aluno.

## Usar o aplicativo

Baixe [UrnaEstudantil.exe](releases/UrnaEstudantil.exe). Em cada notebook, crie uma pasta própria no disco local, copie apenas esse executável e abra-o. As fotos e a interface já estão incluídas; basta executar o arquivo, sem instalação ou extração.

Na primeira execução, o programa cria a pasta `Dados` ao lado do EXE. Ela guarda o estado dessa urna e deve permanecer ali. Para outro notebook, copie somente o EXE original, sem levar `Dados` de uma urna já iniciada. Ao atualizar o aplicativo na mesma pasta, substitua apenas o EXE e preserve `Dados`.

A primeira execução já abre a votação com as três chapas prontas. Cada notebook recebe automaticamente um nome no formato **Urna XXXXXXXX**, com oito caracteres de identificação. Atribua cada turma a um notebook e anote essa distribuição. Ao retomar uma pasta existente, os dados e o estado da urna são preservados; uma urna encerrada continua encerrada.

Ao terminar, use **Finalizar votação**, marque a confirmação de encerramento definitivo e clique em **Finalizar e ver resultado**. O CSV para Excel é baixado automaticamente. Baixe também o JSON de cada notebook para **Somar urnas** nos resultados. Depois de encerrada, use **Ver resultados** para consultar e exportar a apuração.

Na tela inicial e nos detalhes da chapa, **Ampliar foto** mostra a imagem inteira do grupo. Use **Voltar à chapa** para retornar.

Consulte o [manual em HTML](docs/LEIA-ME.html) ou o [manual em PDF](docs/Manual-de-uso.pdf) para usar, finalizar e somar as urnas. O [ZIP completo](releases/Urna-Araci-Zebral.zip) é opcional e reúne materiais de apoio, documentação e fontes. Dados de votação não pertencem ao repositório.

## Chapas cadastradas

- **01 — Chapa Conexão:** Julia Oliveira, do 2º ano A, com foto do grupo, oito integrantes e oito propostas cadastradas: saúde mental e bem-estar, futuro profissional, aluno destaque, apoio aos alunos, melhorias na escola, ideia do mês, campanha solidária e assembleia dos alunos.
- **07 — Liderança Jovem:** Isabelly M, do 1º ano D, com foto do grupo, equipe e propostas cadastradas.
- **10 — Renascer:** Fernanda Santos de Souza, do 1º ano D, com foto do grupo, propostas e oito nomes na equipe cadastrada. **Pyetro, do 2º ano D**, e **Pyetro Wilians, do 1º ano A**, são integrantes distintos.

## Compilar e verificar

Execute a partir da raiz do repositório, no PowerShell do Windows. A compilação usa o compilador do .NET Framework do Windows; Node.js e Python são necessários apenas para as verificações de desenvolvimento.

```powershell
powershell -File build.ps1 -Package
node --check src/web/app.js
python tests/test_urna.py --exe dist/Urna-Araci-Zebral/UrnaEstudantil.exe --web-dir src/web
```

`src/Program.cs` e `src/web/` são as fontes oficiais. A compilação incorpora a interface e seus arquivos no executável em `dist/Urna-Araci-Zebral/`. O comando com `-Package` atualiza `releases/UrnaEstudantil.exe` e o ZIP opcional `releases/Urna-Araci-Zebral.zip`. `tests/` contém as verificações; `docs/`, os manuais; e `packaging/`, o iniciador de apoio `INICIAR.cmd` e o guia `COMECE-AQUI.txt`. Os distribuíveis devem acompanhar as alterações de código e conteúdo.

## Dados e limites

Este **repositório é privado** e inclui nomes e fotos fornecidos para as chapas. Restrinja seu acesso. Dados de votação, listas de presença reais, relatórios reais, credenciais e arquivos de autenticação ficam sempre fora do versionamento.

Uma urna offline não impede, em tempo real, que um aluno tente votar em outro notebook. A escola deve conferir a identidade e atribuir cada turma a uma única urna. A consolidação valida os totais e detecta conflitos entre urnas. O aplicativo escolar não tem certificação do TSE; comparar cópias dos dados produzidas durante a votação pode permitir inferir escolhas. Preserve os arquivos sob controle da equipe da escola.
