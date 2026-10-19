# Verificação da urna portátil

Este documento registra a verificação técnica realizada durante a criação. Os resultados definitivos serão preenchidos após a compilação e execução dos testes.

## Limites da operação em vários notebooks

- Cada notebook é uma urna independente enquanto estiver sem rede. Um aluno que votou em um aparelho ainda poderá ser identificado em outro. A organização deve separar turmas ou listas por notebook e supervisionar a identificação.
- A consolidação deve rejeitar urnas repetidas, eleições incompatíveis e participantes repetidos entre urnas. Uma duplicidade de aluno exige revisão da comissão; não é possível remover seu voto específico sem quebrar o sigilo.
- Nome e série ajudam a organizar a lista, mas não autenticam a identidade e podem confundir homônimos. A comissão deve conferir os alunos presencialmente.
- A lista de presença não deve conter a escolha eleitoral. Um resultado exportado de cada urna deve permitir conferir o total de participantes contra o total de votos.
- Arquivos locais podem ser apagados, copiados ou alterados por quem controla o computador. O aplicativo é uma ferramenta para eleição escolar supervisionada e não oferece as garantias de uma urna oficial.
- A cópia de segurança deve ser feita após finalizar a votação e antes de remover o pendrive. Copiar uma pasta de urna já iniciada para outro notebook também copia sua identidade e seus dados; cada aparelho deve iniciar uma urna própria.

## Escopo dos testes automatizados

O roteiro `test_urna.py` executa o programa real em pastas temporárias, usa as APIs locais por HTTP e verifica:

- configuração, proteção administrativa e restrição a requisições sem o token da sessão;
- voto em candidata, branco e nulo, confirmação repetida e repetição normalizada do aluno;
- ausência das contagens por candidata e lista de alunos no estado público e administrativo antes de finalizar;
- persistência após reiniciar, fechamento e recusa de novos votos;
- coerência entre presença, contagem, exportação e relatório;
- consolidação de urnas independentes e recusa de arquivos repetidos ou incompatíveis;
- detecção de aluno repetido entre urnas;
- exclusão mútua por pasta de dados e recusa de estado danificado, sem apagar o arquivo.

## Resultado

Em 19/10/2026, o executável compilado passou pelo roteiro completo contra duas urnas reais em pastas temporárias. Foram registrados quatro votos na primeira urna (um na primeira candidata, um na segunda, um branco e um nulo) e um na terceira candidata em outra urna. As contagens exportadas foram 1, 1, 1, 1 e 1 no resultado consolidado, total de cinco votos e cinco participantes.

Passaram também a reabertura com dados persistidos, a proibição de votar após finalizar, a exportação idêntica após reiniciar, a conferência do total no CSV, os bloqueios de duplicidade, a exclusão mútua por pasta e a preservação de JSON danificado. O teste não usa nem altera dados de uma eleição do usuário.

Roteiro executado com Python padrão, sem bibliotecas externas, pelo interpretador incluído no ambiente Codex. A saída terminou em `ALL INTEGRATION CHECKS PASSED`.

Na revisão do código foi identificado que guardar o estado anterior a cada voto pode permitir inferir o último voto por comparação de arquivos. A correção retira esse histórico automático e limita os dados administrativos durante a votação. O acesso direto ao computador e aos arquivos continua exigindo supervisão da comissão. A execução final abaixo confirma a correção.

O roteiro completo foi repetido no executável final com a correção de privacidade. Passaram a ausência de histórico `.bak`, a omissão de contagens e lista de alunos no estado administrativo enquanto a votação está aberta, a confirmação simultânea do mesmo voto contada uma única vez e os valores exatos de cada candidata, branco e nulo no CSV. A execução final também terminou em `ALL INTEGRATION CHECKS PASSED`.

A última compilação foi verificada novamente usando números `01`, `07` e `10`. O CSV contém os números como texto, preservando o zero inicial no Excel. O JSON de resultados contém somente identificação, nome e número das candidatas, sem repetir as fotos de configuração; isso reduz os arquivos de consolidação. O roteiro completo passou novamente.

A compilação com o cadastro inicial da chapa Liderança Jovem (`07`) passou novamente pelo roteiro completo. Um teste adicional confirmou que o texto de propostas mantém as quebras de linha ao salvar a configuração. A exportação eleitoral continua limitada a identificação, nome e número das chapas. A redação das seis propostas foi comparada com o texto fornecido pelo usuário e preserva seu conteúdo, com ajustes de ortografia e clareza.

Na conferência específica do cadastro inicial, as fotos da representante (116.750 bytes) e do grupo (139.373 bytes) foram comparadas com os arquivos fornecidos: os dados decodificados são idênticos aos originais. As seis linhas de propostas, o nome e o número da chapa também conferem. As fotos e propostas das outras duas chapas continuam pendentes.

Após acrescentar os campos de representante e integrantes da chapa, um teste específico confirmou gravação e leitura exatas dos nomes e do texto em várias linhas, preservação após reiniciar e compatibilidade com configurações antigas sem esses campos. O teste terminou em `METADATA SMOKE PASSED`. A conferência eleitoral completa já havia passado na compilação imediatamente anterior; a alteração seguinte foi somente nos dados descritivos das chapas.

O cadastro inicial da chapa Renascer (`10`) recebeu uma conferência textual das dez propostas e dos sete integrantes informados. A proposta de trote foi redigida como “Trote em uma sexta-feira por mês”, preservando a frequência sem presumir qual sexta-feira. A nova compilação passou novamente pelo teste específico de metadados, persistência e compatibilidade com configurações antigas; o mecanismo eleitoral permaneceu igual ao já testado.
