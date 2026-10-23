# Verificação da urna portátil

Em **22/10/2026**, o executável da versão genérica **Voz da Escola** passou pela suíte completa de integração. A execução terminou com código zero e `ALL INTEGRATION CHECKS PASSED`.

## Execução

O roteiro usa somente a biblioteca padrão do Python e executa o programa real. Escolas, chapas, integrantes, eleitores, propostas e imagens das fixtures são fictícios. Os dados ficam em diretórios temporários, removidos ao terminar; nenhuma urna real é aberta ou alterada.

```powershell
python tests/test_urna.py --exe dist/Urna-Araci-Zebral/UrnaEstudantil.exe --web-dir src/web
```

O nome da pasta interna de compilação é mantido por compatibilidade. O programa entregue é genérico e não começa com dados de escola, alunos ou chapas anteriores. O registro local desta execução está em `work/validation-generic-2026-10-22.log`, fora do pacote distribuído.

## Resultados verificados

- **EXE isolado:** uma cópia apenas do executável, em pasta inicialmente vazia e iniciada de outro diretório, funcionou sem pasta web ou arquivos auxiliares. Criou `Dados` ao lado do EXE e preservou uma configuração e um voto após reiniciar. Nenhum recurso foi extraído para essas pastas nem para o diretório de trabalho.
- **Recursos embutidos:** página, JavaScript, CSS, favicon e os dois logos PNG foram comparados com as fontes atuais. Os três grupos e o símbolo institucional antigos não estão disponíveis no EXE genérico. O token da página corresponde ao da sessão.
- **Recursos externos:** o argumento `--web-dir` foi comprovado com uma página exclusiva de teste. Diretório inexistente ou recurso obrigatório ausente impede a abertura antes de criar dados novos.
- **Primeira execução:** a urna começa em preparação, com escola e chapas vazias, sem credenciais de senha. Identificações para votar são recusadas até configurar e abrir a eleição explicitamente.
- **Cadastro:** escola, título, identificação da urna, logo opcional, nomes, números `01`, `07` e `10`, fotos de grupo sintéticas, representantes, integrantes e propostas com várias linhas são preservados. Retratos individuais antigos recebidos na configuração são descartados. Um rascunho incompleto pode ser salvo, permanece idêntico após reiniciar e não pode iniciar a votação.
- **Validação do cadastro:** foram recusadas listas com uma ou treze chapas, números repetidos ou malformados, identificações de chapa inválidas, tipos de dados incorretos, texto excessivo ou com caracteres de controle, imagens externas, SVG, base64 inválido, tipo de imagem divergente e imagem maior que 3 MiB. JSON malformado e requisição declarada acima de 64 MiB também foram recusados. Essas tentativas não modificaram o arquivo salvo.
- **Abertura e sessão:** o painel local dispensa senha e exige o token da página para criar uma sessão. Configurar, abrir e confirmar votos sem o token é recusado; configurar ou encerrar sem sessão também. Abrir uma eleição congela sua configuração, mesmo antes do primeiro voto.
- **Votos e duplicidade:** duas confirmações simultâneas da mesma identificação registraram somente um voto. Repetir o token não alterou a contagem. Nomes equivalentes com diferenças de acento, maiúsculas e espaços foram recusados como duplicados na mesma série. Votos nas chapas, branco e nulo foram apurados corretamente.
- **Duas e doze chapas:** cada chapa recebeu um voto fictício registrado pela API, incluindo `c12`. Os mapas de contagem contêm exatamente as chapas cadastradas, branco e nulo. Fotos e logo puderam ser omitidos. CSVs e consolidações válidas de duas urnas foram conferidos nos dois limites; misturar eleições com duas e doze chapas foi recusado.
- **Persistência e encerramento:** reiniciar preserva votos e estado. Depois de finalizar, a urna não reabre, não recebe novos alunos nem confirma identificações pendentes. A exportação encerrada permanece idêntica após reiniciar.
- **Privacidade das respostas:** durante a votação, os estados público e administrativo não mostram contagens por chapa nem a lista de alunos. Não é criado histórico automático `.bak` por voto. A lista exportada de comparecimento não contém escolha ou token de voto; as chapas no arquivo eleitoral têm somente identificação, nome e número, sem fotos, logo ou propostas.
- **CSV e consolidação:** números de dois dígitos são exportados como texto para preservar zeros iniciais no Excel. Contagens de chapas, brancos, nulos e participantes concordam. Urnas repetidas, eleições ou números incompatíveis, totais divergentes, contadores desconhecidos e participantes repetidos entre urnas são recusados.
- **Compatibilidade:** fixtures de arquivos antigos abertos ou encerrados, com quatro votos e credenciais antigas, foram lidas sem alterar seus bytes. Retratos e credenciais não aparecem nas respostas. Preparações antigas completas ou incompletas permanecem em preparação, sem abertura automática e sem regravação; uma preparação inconsistente com votos é recusada sem sobrescrita.
- **Proteção dos arquivos:** outra instância não pode usar a mesma pasta de dados. JSON danificado impede a abertura e é preservado, sem reinicialização silenciosa.

Na consolidação principal, a primeira urna recebeu quatro votos: um na chapa `01`, um na `07`, um branco e um nulo. A segunda recebeu um voto na chapa `10`. O resultado foi **um voto em cada opção, cinco votos e cinco participantes**. Nos ensaios dinâmicos, as consolidações tiveram cinco votos com duas chapas e quinze votos com doze chapas, com valores exatos por opção.

## Verificação visual

O roteiro manual de interface, executado pela equipe em navegador com dados fictícios, confirmou cadastro de três chapas, representantes, propostas e integrantes; alternância entre chapas sem perder alterações; revisão com confirmação obrigatória; upload de PNG e ajuste de imagem para JPEG. Exportar a configuração não inclui contagens, participantes nem nome da urna; importar novamente o mesmo arquivo preservou a foto e o nome local da urna.

A eleição foi aberta, um aluno fictício foi identificado e o número `12` mostrou a chapa e sua foto de grupo. A confirmação registrou um voto, mostrou FIM e retornou automaticamente ao início. As telas inicial e de votação foram conferidas em desktop e com largura de 320 pixels, sem rolagem horizontal.

O encerramento pela interface baixou um CSV com exatamente um voto na candidatura `12`, zero nas demais opções e um participante. O editor do executável final, sem `--web-dir`, foi conferido nas três etapas em 320 pixels e nas etapas de identidade e candidaturas em 800 pixels, sem rolagem horizontal. Selecionar e remover uma logo própria também funcionou. Os navegadores de teste não registraram erros ou avisos de console. As prévias usam somente dados e imagens de demonstração.

## Limites da operação em vários notebooks

- Cada notebook é uma urna independente enquanto estiver sem rede. Separe turmas ou listas por aparelho e supervisione a identificação para evitar votação em dois notebooks.
- A consolidação detecta participantes repetidos; a equipe responsável precisa revisar a ocorrência. O sistema não identifica nem remove o voto específico desse aluno.
- Nome e série não autenticam a identidade e podem confundir homônimos. Confira os alunos presencialmente.
- Quem controla o computador pode copiar, apagar ou alterar arquivos locais. O aplicativo atende a uma eleição escolar supervisionada e não oferece as garantias de uma urna oficial.
- Faça cópias de segurança após finalizar. Para criar outra urna, copie apenas o EXE: copiar uma pasta de dados iniciada também copia sua identidade e seus votos.
- Esta verificação cobre funcionamento e integridade dos cenários descritos. Não mede um máximo universal de eleitores; a operação deve ser ensaiada nos notebooks que serão usados.
