# Voz da Escola no Android

O APK desta entrega é destinado à avaliação da SEDUC. Requer **Android 8.0 ou superior** e **Android System WebView/Chrome 80 ou superior**. A TI da instituição deve autorizar a instalação e seguir seu procedimento de distribuição.

## Assinatura e atualizações

Esta versão usa uma **assinatura local de avaliação**. Para produção, a TI deve definir e proteger uma assinatura fixa. Atualizações do aplicativo precisam da mesma assinatura. Desinstalar a versão anterior para trocar a assinatura pode apagar os dados locais; primeiro finalize e exporte as urnas existentes.

## Preparação e votação

Na primeira abertura, a escola e as chapas estão vazias. Preencha a escola, o título da eleição e a identificação deste aparelho; o logo é opcional. Cadastre de duas a doze chapas, cada uma com nome e número exclusivo de dois dígitos. Fotos de grupo, representante, integrantes e propostas são opcionais.

Salve e revise a configuração antes de abrir. A abertura bloqueia alterações no cadastro. O aluno informa nome e série, digita o número, confere a chapa e confirma o voto; o aplicativo retorna ao início. A equipe deve supervisionar a identificação, pois nome e série não comprovam quem está usando o aparelho.

Ao terminar, finalize a votação. A urna encerrada não recebe novos votos. Salve o **CSV de conferência** e o **JSON de resultados** pelo seletor de arquivos do Android, em local autorizado pela instituição. O voto não aparece associado ao aluno nesses relatórios.

Para outra eleição, exporte os resultados antes de confirmar o novo ciclo. O aplicativo guarda um único estado final daquela urna em seu armazenamento privado e cria uma nova identidade, com zero votos e chapas vazias. Escola, logo e título são mantidos para facilitar o próximo cadastro. Esse arquivo interno não substitui as exportações guardadas fora do aplicativo.

## Fotos e armazenamento

O aplicativo funciona offline e não solicita permissão de internet ou acesso amplo ao armazenamento. Fotos, importações e exportações usam o seletor de arquivos do sistema Android (Storage Access Framework).

Os dados de votação ficam no armazenamento privado do aplicativo. **Não use “Limpar dados” e não desinstale durante uma eleição ou antes de guardar as exportações.** Essas ações podem apagar urnas e arquivos internos. Não há cópia automática para a nuvem.

## Uso com Windows e vários aparelhos

O JSON de configuração é compatível com a versão Windows. Prepare a configuração, exporte-a e importe a mesma configuração nos demais aparelhos antes de abrir a votação. A identificação local da urna deve ser diferente em cada aparelho. Arquivo de configuração contém o cadastro, não os votos.

Cada aparelho é uma urna independente. Distribua turmas ou listas por aparelho para impedir votação duplicada entre eles. Depois de finalizar, reúna os JSONs de resultados e use a função de soma de urnas no Android ou no Windows. O CSV permite conferir a apuração; a consolidação usa os JSONs. Se o mesmo nome e série aparecerem em duas urnas, a soma será bloqueada para revisão da equipe.

## Validação

Os testes de armazenamento, persistência, apuração e compatibilidade entre Windows e Android estão registrados em [ANDROID-VALIDACAO.md](ANDROID-VALIDACAO.md). A existência de um APK compilado não equivale a um teste em aparelho: os resultados e as limitações de execução devem ser considerados conforme esse registro.
