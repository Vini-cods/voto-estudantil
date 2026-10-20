# Verificação da urna portátil

Em **20/10/2026**, o executável final passou pelo roteiro completo de integração, incluindo o funcionamento como arquivo único, a votação imediata sem senha ou preparação, as três chapas com fotos de grupo e a compatibilidade com arquivos antigos. A execução terminou em `ALL INTEGRATION CHECKS PASSED`.

## Execução

O roteiro usa somente a biblioteca padrão do Python e inicia o programa real com dados de votação fictícios em pastas temporárias. Nenhuma urna real é aberta ou alterada.

A execução completa começa com um teste do EXE isolado e depois verifica as operações com `--web-dir` externo. Para executar somente a verificação do arquivo único, acrescente `--standalone-smoke` ao comando.

```powershell
python tests/test_urna.py --exe dist/Urna-Araci-Zebral/UrnaEstudantil.exe --web-dir src/web
```

## Resultados verificados

- Uma cópia apenas do EXE, em uma pasta inicialmente vazia e iniciada com outro diretório de trabalho, funcionou sem pasta `web`, argumentos de recursos ou arquivos auxiliares. O aplicativo criou `Dados` ao lado do EXE.
- A página embutida recebeu o token correto da sessão. JavaScript, CSS, favicon, três fotos de grupo e dois logos PNG foram servidos com conteúdo idêntico às fontes. Nenhum recurso web foi extraído para a pasta do programa, para `Dados` ou para o diretório de trabalho.
- Nesse modo, um voto fictício foi confirmado e preservado após reiniciar. O arquivo de dados existente permaneceu idêntico na reabertura; a apuração após encerrar teve exatamente um voto e um participante.
- O argumento explícito `--web-dir` foi comprovado com uma alteração exclusiva na página externa de teste. Um diretório inexistente ou com um recurso obrigatório ausente impediu a abertura antes de criar a nova pasta de dados.
- Uma urna nova começa aberta, com as três chapas prontas para receber votos, sem gravar credenciais de senha. Um voto foi registrado antes de qualquer acesso à tela de encerramento.
- As três chapas têm números `01`, `07` e `10`, representantes e oito integrantes por chapa. A Conexão tem oito propostas; a Liderança Jovem, seis; a Renascer, dez. Os dois alunos chamados Pyetro, de séries diferentes, permanecem distintos.
- As três fotos de grupo recebidas no estado inicial são idênticas, byte a byte, aos arquivos originais distribuídos. O estado público não apresenta retratos individuais.
- O acesso local ao encerramento não solicita senha. O pedido de acesso exige o token da página e retorna uma sessão; uma tentativa de encerrar sem essa sessão é recusada. Os antigos comandos de preparação, configuração, abertura e login são recusados sem alterar o arquivo de dados.
- Arquivos antigos com votação aberta ou encerrada, quatro votos, retrato individual e credenciais antigas foram lidos sem mudar seus bytes. As respostas ocultam retratos e credenciais; o acesso ao encerramento não usa a senha antiga.
- Arquivos antigos em preparação, completos e sem votos, passaram automaticamente para votação aberta, com ou sem credenciais antigas. Nomes, números, propostas, integrantes, imagens, identificação da urna e demais dados existentes foram preservados. Uma segunda abertura não repetiu a gravação da migração.
- Uma preparação antiga incompleta ou com votos incompatíveis foi recusada, sem sobrescrever o arquivo.
- Duas confirmações simultâneas com a mesma identificação registram somente um voto. Nomes repetidos com diferenças de acento, maiúsculas ou espaços são reconhecidos como duplicados quando a série corresponde.
- Reiniciar o programa preserva o estado aberto ou encerrado e as contagens. Depois do encerramento, novos alunos e identificações pendentes não conseguem votar; a exportação permanece idêntica após reiniciar.
- Durante a votação, os estados público e administrativo não mostram contagens por candidata nem a lista de alunos. Não é criado histórico automático `.bak` a cada voto.
- O CSV contém os valores exatos de cada candidata, branco e nulo. Os números das chapas são exportados como texto, preservando zeros iniciais no Excel.
- A exportação eleitoral contém apenas identificação, nome e número das chapas, sem repetir fotos ou propostas. A lista de comparecimento não contém a escolha nem o token de voto de cada aluno.
- A consolidação recusa urnas repetidas, eleições ou números incompatíveis, totais divergentes e participantes repetidos entre notebooks.
- Uma segunda instância não pode usar a mesma pasta de dados. Um arquivo JSON danificado impede a abertura e é preservado, sem reinicialização silenciosa.

No teste de consolidação, a primeira urna recebeu quatro votos: um na chapa `01`, um na `07`, um branco e um nulo. A segunda recebeu um voto na chapa `10`. O consolidado teve **um voto em cada uma das cinco opções**, total de **cinco votos e cinco participantes**.

## Limites da operação em vários notebooks

- Cada notebook é uma urna independente enquanto estiver sem rede. A comissão deve separar turmas ou listas por aparelho e supervisionar a identificação para evitar que um aluno vote em dois notebooks.
- Se a consolidação encontrar um participante repetido, a comissão precisa revisar a ocorrência. O sistema não identifica nem remove o voto específico desse aluno.
- Nome e série não autenticam a identidade e podem confundir homônimos. A comissão deve conferir os alunos presencialmente.
- Quem controla o computador pode copiar, apagar ou alterar arquivos locais. O aplicativo serve a uma eleição escolar supervisionada e não oferece as garantias de uma urna oficial.
- As cópias de segurança devem ser feitas após finalizar a votação. Não copie uma pasta de urna já iniciada para criar outra: isso também copia sua identidade e seus dados.
