-- Execute uma única vez para limpar resultados da versão que classificava
-- qualquer erro do navegador como supervisório sem resposta.
update public.obras_mapa
set supervisorio_status = 'falha_teste'
where supervisorio_monitorar is true
  and supervisorio_status = 'sem_resposta';
