const FOTOS_BUCKET = 'relatorio-fotos';
const _fotoPaths = {};

function assinaturaFoto(base64) {
  const meio = base64.length >> 1;
  return `${base64.length}:${base64.slice(meio, meio + 40)}${base64.slice(-40)}`;
}

function dataUrlParaBlob(dataUrl) {
  const separador = dataUrl.indexOf(',');
  if (separador < 0) throw new Error('Dados da imagem inválidos.');
  const cabecalho = dataUrl.slice(0, separador);
  const bytes = atob(dataUrl.slice(separador + 1));
  const dados = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) dados[i] = bytes.charCodeAt(i);
  const tipo = (cabecalho.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  return new Blob([dados], { type: tipo });
}

function blobParaDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Não foi possível ler a foto baixada.'));
    reader.readAsDataURL(blob);
  });
}

async function baixarFotoBase64(path) {
  const { data, error } = await supa.storage.from(FOTOS_BUCKET).download(path);
  if (error) throw error;
  if (!data) throw new Error('O Storage não retornou o arquivo da foto.');
  return blobParaDataUrl(data);
}

async function tentarBaixarFoto(foto) {
  if (!foto?.path) throw new Error('A foto não possui caminho no Storage.');
  foto.base64 = await baixarFotoBase64(foto.path);
  foto._sig = assinaturaFoto(foto.base64);
  delete foto._loadError;
}

async function hidratarFotos(relatorioId, grupos) {
  const fila = [];
  const paths = new Set();
  (grupos || []).forEach(grupo => (grupo.fotos || []).forEach(foto => {
    if (!foto || !foto.path) return;
    paths.add(foto.path);
    if (foto.base64) foto._sig = assinaturaFoto(foto.base64);
    else fila.push(foto);
  }));
  _fotoPaths[relatorioId] = paths;

  let falhas = 0;
  let indice = 0;
  const worker = async () => {
    while (indice < fila.length) {
      const foto = fila[indice++];
      try {
        foto.base64 = await baixarFotoBase64(foto.path);
        foto._sig = assinaturaFoto(foto.base64);
      } catch (error) {
        foto._loadError = error.message || String(error);
        falhas++;
        console.error(`Falha ao baixar foto do Storage (${foto.path}):`, error);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return falhas;
}

async function prepararFotosParaSalvar(relatorio) {
  const grupos = relatorio.fotos || [];
  const paths = new Set();
  let falhas = 0;

  for (const grupo of grupos) {
    for (const foto of grupo.fotos || []) {
      foto._inline = false;
      if (foto.base64) {
        const assinatura = assinaturaFoto(foto.base64);
        if (!foto.path || foto._sig !== assinatura) {
          const path = `${relatorio.id}/${foto.id}.jpg`;
          try {
            const { error } = await supa.storage.from(FOTOS_BUCKET).upload(
              path,
              dataUrlParaBlob(foto.base64),
              { contentType: 'image/jpeg', upsert: true }
            );
            if (error) throw error;
            foto.path = path;
            foto._sig = assinatura;
          } catch (error) {
            console.error(`Falha ao enviar foto para o Storage (${path}):`, error);
            falhas++;
            foto._inline = true;
            continue;
          }
        }
      }
      if (foto.path && !foto._inline) paths.add(foto.path);
    }
  }

  const fotos = grupos.map(grupo => ({
    ...grupo,
    fotos: (grupo.fotos || []).map(foto => {
      const salvo = {};
      Object.keys(foto).forEach(chave => {
        if (!chave.startsWith('_')) salvo[chave] = foto[chave];
      });
      if (salvo.path && !foto._inline) delete salvo.base64;
      else delete salvo.path;
      return salvo;
    }),
  }));
  return { fotos, paths, falhas };
}

async function limparFotosOrfas(relatorioId, pathsAtuais) {
  const antigos = _fotoPaths[relatorioId];
  _fotoPaths[relatorioId] = pathsAtuais;
  if (!antigos) return;
  const remover = [...antigos].filter(path =>
    !pathsAtuais.has(path) && path.startsWith(`${relatorioId}/`)
  );
  if (remover.length) {
    const { error } = await supa.storage.from(FOTOS_BUCKET).remove(remover);
    if (error) console.error('Falha ao remover fotos órfãs do Storage:', error);
  }
}

async function clonarFotos(novoId, grupos) {
  if (!Array.isArray(grupos)) return null;
  const copia = JSON.parse(JSON.stringify(grupos));
  for (const grupo of copia) {
    for (const foto of grupo.fotos || []) {
      if (!foto.path) continue;
      const novoPath = `${novoId}/${foto.id}.jpg`;
      const { error } = await supa.storage.from(FOTOS_BUCKET).copy(foto.path, novoPath);
      if (!error) {
        foto.path = novoPath;
        continue;
      }
      console.error(`Falha ao copiar foto do Storage (${foto.path}):`, error);
      try {
        foto.base64 = await baixarFotoBase64(foto.path);
        delete foto.path;
      } catch (downloadError) {
        console.error(`Falha ao baixar foto para duplicação (${foto.path}):`, downloadError);
      }
    }
  }
  return copia;
}

async function removerFotosDosRelatorios(ids) {
  let falhas = 0;
  for (const id of ids) {
    const { data, error } = await supa.storage.from(FOTOS_BUCKET).list(id, { limit: 1000 });
    if (error) {
      console.error(`Falha ao listar fotos do relatório ${id}:`, error);
      falhas++;
      continue;
    }
    if (!data?.length) continue;
    const { error: erroRemocao } = await supa.storage.from(FOTOS_BUCKET)
      .remove(data.map(foto => `${id}/${foto.name}`));
    if (erroRemocao) {
      console.error(`Falha ao remover fotos do relatório ${id}:`, erroRemocao);
      falhas++;
    }
  }
  return falhas;
}
