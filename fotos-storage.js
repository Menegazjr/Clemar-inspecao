// ═══════════════════════════════════════════════
//  FOTOS NO SUPABASE STORAGE
//  No banco ficam só os caminhos das fotos. Ao abrir o relatório o app baixa as fotos e
//  continua trabalhando com base64 em memória (tela, visualizador e exportações não mudam).
//  Se o Storage falhar, a foto continua gravada no formato antigo — nunca se perde.
// ═══════════════════════════════════════════════
const FOTOS_BUCKET = 'relatorio-fotos';
const _fotoPaths = {};   // id do relatório -> caminhos que estão gravados no banco

function _assinatura(s) { const m = s.length >> 1; return s.length + ':' + s.slice(m, m + 40) + s.slice(-40); }

function _dataUrlParaBlob(d) {
  const i = d.indexOf(','), cab = d.slice(0, i), bin = atob(d.slice(i + 1));
  const u8 = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
  return new Blob([u8], { type: (cab.match(/data:([^;]+)/) || [])[1] || 'image/jpeg' });
}
function _blobParaDataUrl(b) {
  return new Promise((ok, err) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = err; r.readAsDataURL(b); });
}

async function baixarFotoBase64(path) {
  try {
    const { data, error } = await supa.storage.from(FOTOS_BUCKET).download(path);
    if (error || !data) return null;
    return await _blobParaDataUrl(data);
  } catch (e) { return null; }
}

// Baixa do Storage as fotos que já foram migradas. Devolve quantas falharam.
async function hidratarFotos(relId, grupos) {
  const fila = [], paths = new Set();
  (grupos || []).forEach(g => (g.fotos || []).forEach(f => {
    if (!f || !f.path) return;
    paths.add(f.path);
    if (f.base64) f._sig = _assinatura(f.base64); else fila.push(f);
  }));
  _fotoPaths[relId] = paths;
  let falhas = 0, i = 0;
  const worker = async () => {
    while (i < fila.length) {
      const f = fila[i++], b = await baixarFotoBase64(f.path);
      if (b) { f.base64 = b; f._sig = _assinatura(b); } else falhas++;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return falhas;
}

// Sobe para o Storage as fotos novas/alteradas e devolve a versão que vai para o banco
// (só caminhos). Foto que não subir segue inline (base64), como antes.
async function prepararFotosParaSalvar(r) {
  const grupos = r.fotos || [], paths = new Set();
  let falhas = 0;
  for (const g of grupos) for (const f of (g.fotos || [])) {
    f._inline = false;
    if (f.base64) {
      const sig = _assinatura(f.base64);
      if (!f.path || f._sig !== sig) {
        const path = `${r.id}/${f.id}.jpg`;
        let erro = null;
        try {
          const res = await supa.storage.from(FOTOS_BUCKET).upload(path, _dataUrlParaBlob(f.base64), { contentType: 'image/jpeg', upsert: true });
          erro = res.error;
        } catch (e) { erro = e; }
        if (erro) { falhas++; f._inline = true; continue; }
        f.path = path; f._sig = sig;
      }
    }
    if (f.path && !f._inline) paths.add(f.path);
  }
  const banco = grupos.map(g => ({
    ...g,
    fotos: (g.fotos || []).map(f => {
      const o = {};
      Object.keys(f).forEach(k => { if (k[0] !== '_') o[k] = f[k]; });
      if (o.path && !f._inline) delete o.base64; else delete o.path;
      return o;
    })
  }));
  return { fotos: banco, paths, falhas };
}

// Depois de salvar: apaga do Storage as fotos que saíram do relatório (só da pasta dele)
async function limparFotosOrfas(relId, pathsAtuais) {
  const antigos = _fotoPaths[relId];
  _fotoPaths[relId] = pathsAtuais;
  if (!antigos) return;
  const remover = [...antigos].filter(p => !pathsAtuais.has(p) && p.startsWith(relId + '/'));
  if (remover.length) { try { await supa.storage.from(FOTOS_BUCKET).remove(remover); } catch (e) {} }
}

// Duplicar: copia os arquivos para a pasta do novo relatório (nunca compartilha arquivo entre relatórios)
async function clonarFotos(novoId, grupos) {
  if (!Array.isArray(grupos)) return null;
  const clone = JSON.parse(JSON.stringify(grupos));
  let mudou = false;
  for (const g of clone) for (const f of (g.fotos || [])) {
    if (!f || !f.path) continue;
    const novo = `${novoId}/${f.id}.jpg`;
    const { error } = await supa.storage.from(FOTOS_BUCKET).copy(f.path, novo);
    if (!error) { f.path = novo; mudou = true; continue; }
    const b = await baixarFotoBase64(f.path);       // plano B: embute a foto na cópia
    if (b) { f.base64 = b; delete f.path; mudou = true; }
  }
  return mudou ? clone : null;
}

// Exclusão definitiva (lixeira): remove os arquivos dos relatórios apagados
async function removerFotosDosRelatorios(ids) {
  for (const id of ids) {
    try {
      const { data } = await supa.storage.from(FOTOS_BUCKET).list(id, { limit: 1000 });
      if (data && data.length) await supa.storage.from(FOTOS_BUCKET).remove(data.map(f => `${id}/${f.name}`));
    } catch (e) {}
  }
}
