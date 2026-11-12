# Clemar-inspecao

Aplicação estática de inspeções e mapa de obras da Clemar Engenharia.

## Estrutura

- `index.html`, `mapa.html`, `manifest.json` e `sw.js`: páginas de entrada e arquivos da PWA, mantidos na raiz para preservar a publicação.
- `js/`: scripts da aplicação.
- `js/vendor/`: biblioteca DOCX já empacotada.
- `css/`: folha de estilos.
- `assets/brand/`: logotipos.
- `assets/icons/`: ícones da aplicação.
- `sql/`: scripts de configuração e migração do Supabase.
- `Backup/`: cópias antigas, mantidas separadas e fora da publicação ativa.

Fotos de relatórios ficam no bucket `relatorio-fotos` do Supabase Storage; não são arquivos locais do projeto.

O script `sql/supabase_supervisorio_reclassificar_erros.sql` é uma migração pontual: execute uma única vez para reclassificar resultados antigos de ping como inconclusivos.

## Monitoramento dos supervisórios

O mapa é estático e o navegador não consegue testar de forma confiável endereços da VPN. O script `tools/monitor-supervisorios.ps1` faz a verificação de porta a partir de um PC Windows conectado à VPN; uma conexão TCP aceita marca o supervisório como respondendo, e uma falha após 8 segundos marca sem resposta.

1. No PC monitor, mantenha uma cópia atualizada do projeto e conecte-se à VPN.
2. No PowerShell, execute uma vez:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ".\tools\monitor-supervisorios.ps1" -Once
   ```

3. Informe o e-mail e a senha de uma conta aprovada no mapa. A sessão de renovação é protegida pelo Windows (DPAPI) para o usuário atual; nenhuma senha ou chave de serviço é gravada no projeto.
4. Para monitorar continuamente, execute o mesmo comando sem `-Once` e deixe a janela aberta, ou configure essa execução no Agendador de Tarefas para iniciar ao entrar na mesma conta do Windows. O PC precisa estar ligado e conectado à VPN.

O agente consulta as obras habilitadas, atualiza os estados no Supabase a cada 30 minutos e grava um log local em `%LOCALAPPDATA%\Clemar\Monitor\monitor.log`. A página apenas exibe esses resultados e atualiza os dados periodicamente.
