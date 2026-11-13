async function excluirPendenciaComFotos(id) {
  if (currentUser?.role !== 'admin') {
    return { error: new Error('Somente administradores podem excluir pendências.') };
  }

  const { data: pendencia, error: erroPendencia } = await supa
    .from('pendencias')
    .select('fotos,fotos_correcao')
    .eq('id', id)
    .maybeSingle();
  if (erroPendencia) return { error: erroPendencia };
  if (!pendencia) return { error: new Error('Pendência não encontrada.') };

  const { data: historico, error: erroHistorico } = await supa
    .from('pendencias_historico')
    .select('fotos')
    .eq('pendencia_id', id);
  if (erroHistorico) return { error: erroHistorico };

  const fotos = [...new Set([
    ...(pendencia.fotos || []),
    ...(pendencia.fotos_correcao || []),
    ...(historico || []).flatMap(item => item.fotos || []),
  ].filter(path => typeof path === 'string' && path))];
  const { data: excluida, error: erroExclusao } = await supa
    .from('pendencias')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (erroExclusao) return { error: erroExclusao };
  if (!excluida) return { error: new Error('Pendência não encontrada ou sem permissão para excluir.') };

  if (!fotos.length) return { error: null, erroFotos: null };
  const { error: erroFotos } = await supa.storage.from('pendencia-fotos').remove(fotos);
  return { error: null, erroFotos };
}
