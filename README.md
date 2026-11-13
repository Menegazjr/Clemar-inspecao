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

## Módulo de pendências

A página `pendencias.html` reúne as pendências por obra, com indicadores, prazos, prioridade, histórico e validação pelo supervisor. O módulo utiliza as tabelas `pendencias` e `pendencias_historico` e o bucket privado `pendencia-fotos`.

### Ativação no Supabase

1. Abra o SQL Editor do projeto Supabase usado pela aplicação.
2. Execute `sql/supabase_pendencias.sql` depois de `sql/supabase_rls_hardening.sql`.
3. Na tela Gestão, um administrador pode promover usuários aprovados para o perfil **Supervisor**. Administradores também podem validar correções.
4. Publique os arquivos atualizados da aplicação.

Os status do fluxo são somente `pendente`, `aguardando_validacao` e `concluida`. O responsável registra a descrição da correção e pode anexar fotos; somente supervisor ou administrador aprova ou devolve, com justificativa obrigatória na devolução. O nome e o ID do usuário são gravados automaticamente no histórico.
