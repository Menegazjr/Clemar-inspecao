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

O script `sql/supabase_supervisorio_reclassificar_erros.sql` é uma migração pontual para limpar estados antigos de “sem resposta” gerados pela verificação anterior.

## Verificação dos supervisórios

Quando habilitado, o navegador tenta acessar o link a cada 30 minutos enquanto o mapa está aberto. O ícone verde aparece somente nesse navegador quando a requisição recebe uma resposta; falhas e bloqueios não exibem ícone. O resultado não é salvo nem compartilhado. Links acessíveis apenas pela VPN só podem ser testados em um dispositivo conectado a ela.
