# Verificação da urna portátil

Em **20/10/2026**, o executável final passou pelo roteiro completo de integração, incluindo o cadastro das três chapas, as fotos de grupo e a compatibilidade com arquivos antigos. A execução terminou em `ALL INTEGRATION CHECKS PASSED`.

## Execução

O roteiro usa somente a biblioteca padrão do Python e inicia o programa real com dados de votação fictícios em pastas temporárias. Nenhuma urna real é aberta ou alterada.

```powershell
python tests/test_urna.py --exe dist/Urna-Araci-Zebral/UrnaEstudantil.exe --web-dir src/web
```

## Resultados verificados

- As três chapas têm números `01`, `07` e `10`, representantes e oito integrantes por chapa. A Conexão tem oito propostas; a Liderança Jovem, seis; a Renascer, dez. Os dois alunos chamados Pyetro, de séries diferentes, permanecem distintos.
- As três fotos de grupo recebidas no estado inicial são idênticas, byte a byte, aos arquivos originais distribuídos. O estado público não apresenta retratos individuais.
- Configurações antigas com retratos individuais continuam sendo aceitas, mas o retrato não é salvo em novas configurações. Ao abrir um arquivo de dados antigo, as respostas pública e administrativa ocultam o retrato sem reescrever o arquivo existente.
- Requisições sem o token da sessão, operações administrativas sem autorização, PIN incorreto e tentativa de configurar novamente uma urna preparada são recusados.
- Duas confirmações simultâneas com a mesma identificação registram somente um voto. Nomes repetidos com diferenças de acento, maiúsculas ou espaços são reconhecidos como duplicados quando a série corresponde.
- Reiniciar o programa preserva o estado aberto ou encerrado e as contagens. Depois do encerramento, novos alunos e identificações pendentes não conseguem votar; a exportação permanece idêntica após reiniciar.
- Durante a votação, os estados público e administrativo não mostram contagens por candidata nem a lista de alunos. Não é criado histórico automático `.bak` a cada voto.
- O CSV contém os valores exatos de cada candidata, branco e nulo. Os números das chapas são exportados como texto, preservando zeros iniciais no Excel.
- A exportação eleitoral contém apenas identificação, nome e número das chapas, sem repetir fotos ou propostas. A lista de comparecimento não contém a escolha nem o token de voto de cada aluno.
- A consolidação recusa urnas repetidas, eleições ou números incompatíveis, totais divergentes e participantes repetidos entre notebooks.
- Uma segunda instância não pode usar a mesma pasta de dados. Um arquivo JSON danificado impede a abertura e é preservado, sem reinicialização silenciosa.

No teste de apuração, a primeira urna recebeu quatro votos: um na chapa `01`, um na `07`, um branco e um nulo. A segunda recebeu um voto na chapa `10`. O consolidado teve **um voto em cada uma das cinco opções**, total de **cinco votos e cinco participantes**.

## Limites da operação em vários notebooks

- Cada notebook é uma urna independente enquanto estiver sem rede. A comissão deve separar turmas ou listas por aparelho e supervisionar a identificação para evitar que um aluno vote em dois notebooks.
- Se a consolidação encontrar um participante repetido, a comissão precisa revisar a ocorrência. O sistema não identifica nem remove o voto específico desse aluno.
- Nome e série não autenticam a identidade e podem confundir homônimos. A comissão deve conferir os alunos presencialmente.
- Quem controla o computador pode copiar, apagar ou alterar arquivos locais. O aplicativo serve a uma eleição escolar supervisionada e não oferece as garantias de uma urna oficial.
- As cópias de segurança devem ser feitas após finalizar a votação. Não copie uma pasta de urna já iniciada para criar outra: isso também copia sua identidade e seus dados.
