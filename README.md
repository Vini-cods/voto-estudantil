# Voz da Escola — Urna Estudantil

Aplicativo portátil para a eleição do grêmio da escola **Araci Zebral Teixeira**, em notebooks com **Windows 10 ou 11**. Funciona sem internet, com executável em C#/.NET Framework e interface local no navegador. Cada notebook guarda uma urna independente; um pendrive permite distribuir o pacote e reunir os resultados ao final.

O aluno informa nome e série/turma, digita os dois dígitos da chapa e confirma a escolha. A interface destaca uma foto do grupo de cada chapa, com o nome da representante, propostas e integrantes. A comissão configura a eleição com PIN, encerra a votação e exporta CSV para Excel, JSON para consolidação e relatório para impressão/PDF. O sistema mantém contagens agregadas e uma lista de comparecimento separada, sem relatório de voto por aluno.

## Usar o aplicativo

Baixe [releases/Urna-Araci-Zebral.zip](releases/Urna-Araci-Zebral.zip), extraia a pasta inteira no disco local de cada notebook e abra `UrnaEstudantil.exe`. Distribua cópias ainda não iniciadas; cada urna deve ter identificação própria. Configure uma urna e use a exportação/importação de configuração para compartilhar nomes, números, fotos e propostas com as demais.

Na tela inicial e nos detalhes da chapa, **Ampliar foto** mostra a imagem inteira do grupo. Use **Voltar à chapa** para retornar.

Consulte o [manual em HTML](docs/LEIA-ME.html) ou o [manual em PDF](docs/Manual-de-uso.pdf) para preparar, operar, finalizar e somar as urnas. A pasta `Dados` criada durante o uso é essencial para preservar os votos e não pertence ao repositório.

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

`src/Program.cs` e `src/web/` são as fontes oficiais. O comando da raiz compila em `dist/Urna-Araci-Zebral/` e, com `-Package`, gera o pacote distribuível versionado `releases/Urna-Araci-Zebral.zip`. `tests/` contém as verificações; `docs/`, os manuais; e `packaging/`, o iniciador `INICIAR.cmd` e o guia `COMECE-AQUI.txt`. O pacote deve acompanhar as alterações de código e conteúdo.

## Dados e limites

Este **repositório é privado** e inclui nomes e fotos fornecidos para as chapas. Restrinja seu acesso. Dados de votação, listas de presença reais, relatórios reais, PINs, credenciais e arquivos de autenticação ficam sempre fora do versionamento.

Uma urna offline não impede, em tempo real, que um aluno tente votar em outro notebook. A escola deve conferir a identidade e atribuir cada turma a uma única urna. A consolidação valida os totais e detecta conflitos entre urnas. O aplicativo escolar não tem certificação do TSE; comparar cópias dos dados produzidas durante a votação pode permitir inferir escolhas. Preserve os arquivos sob controle da comissão.
