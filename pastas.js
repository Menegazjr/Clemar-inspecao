// Converte qualquer imagem (JPEG, etc.) para PNG real via canvas.
// Necessário porque a lib docx.js sempre grava a imagem internamente
// com extensão/tipo ".png", não importa o formato original — se os
// bytes não forem realmente PNG, o Word considera o arquivo corrompido.
function converterParaPngBase64(dataUri) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Falha ao carregar imagem para conversão PNG'));
    img.src = dataUri;
  });
}

// ═══════════════════════════════════════════════
async function exportarWord() {
  const r = getRelatorioAtual();
  if (!r) { showAlert('Nenhum relatório aberto.', 'warn'); return; }
  // Coleta campos atuais do formulário
  r.data           = document.getElementById('fieldData').value || null;
  r.obra           = document.getElementById('fieldObra').value;
  r.cliente        = document.getElementById('fieldCliente').value;
  r.localidade     = document.getElementById('fieldLocalidade').value;
  r.responsavel    = document.getElementById('fieldResponsavel').value;
  r.cargo          = document.getElementById('fieldCargo').value;
  r.objetivo       = getEditorHtml(_quillObjetivo);
  r.observacoes    = getEditorHtml(_quillObservacoes);
  r.situacao       = document.getElementById('fieldSituacao').value;
  r.parecer        = getEditorHtml(_quillParecer);
  r.assin_nome     = document.getElementById('fieldAssinNome').value;
  r.assin_data     = document.getElementById('fieldAssinData').value;
  r.cc             = document.getElementById('fieldCC').value;
  (r.fotos||[]).forEach(f => { salvarCamposFoto(f.id); });

  if (typeof docx === 'undefined') {
    showAlert('Biblioteca docx.js não carregada. Verifique conexão.', 'err');
    return;
  }

  // Mostrar overlay
  const ov = document.getElementById('exportOverlay');
  const msg = document.getElementById('exportMsg');
  ov.classList.add('open');
  msg.textContent = 'Preparando documento...';

  try {
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
            ImageRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
            ShadingType, VerticalAlign, PageBreak, PageNumber, Header, Footer } = docx;

    await new Promise(r => setTimeout(r, 50));
    msg.textContent = 'Processando fotos...';
    await new Promise(r => setTimeout(r, 30));

    // Helpers
    const cel = (text, w, bold, shade) => new TableCell({
      width: { size: w, type: WidthType.DXA },
      shading: shade ? { fill: shade, type: ShadingType.CLEAR } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      borders: { top: bd(), bottom: bd(), left: bd(), right: bd() },
      children: [new Paragraph({ children: [new TextRun({ text: String(text||'—'), bold: !!bold, size: 20, font: 'Arial' })] })],
    });
    const bd = () => ({ style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' });
    const bds = () => ({ top: bd(), bottom: bd(), left: bd(), right: bd() });

    function rowInfo(label, value) {
      return new TableRow({ children: [
        new TableCell({ width: { size: 2800, type: WidthType.DXA }, shading: { fill: 'E8EDF3', type: ShadingType.CLEAR }, margins: { top:80,bottom:80,left:120,right:120 }, borders: bds(),
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, font: 'Arial', color: '1A2940' })] })] }),
        new TableCell({ width: { size: 6560, type: WidthType.DXA }, margins: { top:80,bottom:80,left:120,right:120 }, borders: bds(),
          children: [new Paragraph({ children: [new TextRun({ text: String(value||'—'), size: 20, font: 'Arial' })] })] }),
      ]});
    }

    function secTitle(text) {
      return new Paragraph({
        spacing: { before: 280, after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: 'E8A020', space: 4 } },
        children: [new TextRun({ text, bold: true, size: 26, font: 'Arial', color: '1A2940' })],
      });
    }

    function bloco(text) {
      const linhas = String(text||'—').split('\n');
      return linhas.map((linha, i) => new Paragraph({
        spacing: { before: i === 0 ? 60 : 0, after: i === linhas.length - 1 ? 60 : 40 },
        children: [new TextRun({ text: linha, size: 20, font: 'Arial' })],
      }));
    }

    function pushBloco(children, text) {
      const items = bloco(text);
      items.forEach(p => children.push(p));
    }

    const children = [];

    // ── Logo no cabeçalho do Word — mesmo arquivo do login ──
    try {
      const resp = await fetch('logo-clemar-cores.png');
      if (!resp.ok) throw new Error('logo não encontrado (HTTP ' + resp.status + ')');
      const buf  = await resp.arrayBuffer();
      const arr  = new Uint8Array(buf);
      // Valida assinatura PNG real (89 50 4E 47 0D 0A 1A 0A) antes de
      // embutir — se o fetch trouxe HTML de erro (404) ou outra coisa,
      // isso corromperia o .docx inteiro.
      const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      const isPng = arr.length > 8 && PNG_SIG.every((b, i) => arr[i] === b);
      if (!isPng) throw new Error('arquivo do logo não é um PNG válido');
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 120 },
        children: [new ImageRun({
          data: arr,
          transformation: { width: 200, height: 60 },
        })],
      }));
    } catch(e) { console.warn('Logo Word:', e); }

    // ── Cabeçalho do documento ──
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 180 },
      children: [new TextRun({ text: 'RELATÓRIO DE VISITA DE OBRA', bold: true, size: 36, font: 'Arial', color: '1A2940' })],
    }));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 80 },
      children: [new TextRun({ text: 'Clemar Engenharia', size: 24, font: 'Arial', color: '888888' })],
    }));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 320 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: 'E8A020', space: 4 } },
      children: [new TextRun({ text: `Visita Nº ${String(r.numero).padStart(3,'0')}  ·  ${r.data ? fmtData(r.data) : '—'}`, size: 22, font: 'Arial', color: 'E8A020', bold: true })],
    }));

    // ── 01 Identificação ──
    children.push(secTitle('01 — IDENTIFICAÇÃO DA VISITA'));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [2800, 6560],
      rows: [
        rowInfo('Nº do Relatório', String(r.numero).padStart(3,'0')),
        rowInfo('Início da Inspeção', r.data ? fmtData(r.data) : '—'),
        rowInfo('Fim da Inspeção', r.data_fim ? fmtData(r.data_fim) : '—'),
        rowInfo('Cliente', r.cliente),
        rowInfo('Obra / Projeto', r.obra),
        rowInfo('Centro de Custo', r.cc),
        rowInfo('Localidade', r.localidade),
        rowInfo('Responsável', r.responsavel),
        rowInfo('Cargo / Função', r.cargo),
      ],
    }));

    // ── 02 Objetivo ──
    children.push(secTitle('02 — OBJETIVO DA VISITA'));
    // Objetivo com formatação rica
    const parasObj = (r.objetivo||'').split(/<\/p>|<br>/).filter(Boolean);
    if (parasObj.length <= 1) {
      children.push(new Paragraph({ spacing:{before:60,after:60}, children: htmlParaRuns(r.objetivo) }));
    } else {
      const divObj = document.createElement('div');
      divObj.innerHTML = r.objetivo || '';
      divObj.querySelectorAll('p').forEach((p,i,arr) => {
        children.push(new Paragraph({ spacing:{before:i===0?60:0,after:i===arr.length-1?60:30}, children: htmlParaRuns(p.innerHTML) }));
      });
    }

    // ── 03 Registro Fotográfico ──
    msg.textContent = 'Inserindo fotos no documento...';
    await new Promise(x => setTimeout(x, 30));

    children.push(secTitle('03 — REGISTRO FOTOGRÁFICO'));

    if (!r.fotos || r.fotos.length === 0) {
      pushBloco(children, 'Nenhuma foto registrada nesta visita.');
    } else {
      for (let i = 0; i < r.fotos.length; i++) {
        const f = r.fotos[i];
        msg.textContent = `Processando foto ${i+1} de ${r.fotos.length}...`;
        await new Promise(x => setTimeout(x, 20));

        // Número da foto
        children.push(new Paragraph({
          spacing: { before: 200, after: 80 },
          children: [
            new TextRun({ text: `FOTO ${String(i+1).padStart(2,'0')}`, bold: true, size: 22, font: 'Arial', color: 'E8A020' }),
            new TextRun({ text: f.local ? `  —  ${f.local}` : '', size: 20, font: 'Arial', color: '1A2940' }),
          ],
        }));

        // Imagem
        if (f.base64 && f.base64.length > 100) {
          try {
            // Converte para PNG real (a lib docx.js grava sempre como .png)
            const pngBase64 = await converterParaPngBase64(f.base64);
            // Dimensões em pixels (ImageRun recebe px, não EMU)
            const maxPxW = 530;
            let pxW, pxH;
            if (f.largura && f.altura && f.largura > 0) {
              const ratio = f.altura / f.largura;
              pxW = Math.min(f.largura, maxPxW);
              pxH = Math.round(pxW * ratio);
              const maxPxH = 420;
              if (pxH > maxPxH) { pxH = maxPxH; pxW = Math.round(pxH / ratio); }
            } else {
              pxW = maxPxW; pxH = Math.round(maxPxW * 0.75);
            }
            children.push(new Paragraph({
              spacing: { before: 40, after: 60 },
              children: [new ImageRun({ data: pngBase64, transformation: { width: pxW, height: pxH } })],
            }));
          } catch(e) {
            console.error('ImageRun erro:', e); pushBloco(children, '[Foto ' + (i+1) + ': ' + e.message + ']');
          }
        } else {
          pushBloco(children, '[Sem foto]');
        }

        // Descrição
        children.push(new Paragraph({
          spacing: { before: 60, after: 40 },
          children: [new TextRun({ text: '📍 Local: ', bold: true, size: 20, font: 'Arial', color: '1A2940' }),
                     new TextRun({ text: f.local || '—', size: 20, font: 'Arial' })],
        }));
        children.push(new Paragraph({
          spacing: { before: 40, after: 60 },
          children: [new TextRun({ text: '📝 Descrição: ', bold: true, size: 20, font: 'Arial', color: '1A2940' }),
                     new TextRun({ text: f.descricao || '—', size: 20, font: 'Arial' })],
        }));
        children.push(new Paragraph({
          spacing: { before: 20, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0', space: 2 } },
          children: [],
        }));
      }
    }

    // ── 04 Observações ──
    children.push(secTitle('04 — OBSERVAÇÕES GERAIS'));
    const divObs = document.createElement('div');
    divObs.innerHTML = r.observacoes || '—';
    const pObss = divObs.querySelectorAll('p');
    if (pObss.length > 0) {
      pObss.forEach((p,i,arr) => children.push(new Paragraph({ spacing:{before:i===0?60:0,after:i===arr.length-1?60:30}, children: htmlParaRuns(p.innerHTML) })));
    } else {
      children.push(new Paragraph({ spacing:{before:60,after:60}, children: htmlParaRuns(r.observacoes) }));
    }

    // ── 05 Conclusão ──
    children.push(secTitle('05 — CONCLUSÃO / PARECER TÉCNICO'));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [2800, 6560],
      rows: [
        rowInfo('Situação Geral', r.situacao),
      ],
    }));
    children.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [new TextRun({ text: 'Parecer Técnico:', bold: true, size: 20, font: 'Arial' })] }));
    const divPar = document.createElement('div');
    divPar.innerHTML = r.parecer || '—';
    const pPars = divPar.querySelectorAll('p');
    if (pPars.length > 0) {
      pPars.forEach((p,i,arr) => children.push(new Paragraph({ spacing:{before:i===0?60:0,after:i===arr.length-1?60:30}, children: htmlParaRuns(p.innerHTML) })));
    } else {
      children.push(new Paragraph({ spacing:{before:60,after:60}, children: htmlParaRuns(r.parecer) }));
    }

    // ── 06 Assinatura ──
    children.push(secTitle('06 — RESPONSÁVEL PELO RELATÓRIO'));
    children.push(new Paragraph({ spacing: { before: 400, after: 0 }, children: [] }));
    children.push(new Paragraph({
      spacing: { before: 0, after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '1A2940', space: 2 } },
      children: [new TextRun({ text: ' ', size: 20, font: 'Arial' })],
    }));
    children.push(new Paragraph({
      spacing: { before: 60, after: 20 },
      children: [new TextRun({ text: r.assin_nome || r.responsavel || '—', bold: true, size: 22, font: 'Arial', color: '1A2940' })],
    }));
    children.push(new Paragraph({
      spacing: { before: 0, after: 20 },
      children: [new TextRun({ text: r.cargo || '—', size: 20, font: 'Arial' })],
    }));
    children.push(new Paragraph({
      spacing: { before: 0, after: 20 },
      children: [new TextRun({ text: r.assin_registro || '', size: 20, font: 'Arial', color: '555555' })],
    }));
    children.push(new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [new TextRun({ text: `Emitido em: ${r.assin_data ? fmtData(r.assin_data) : fmtData(r.data)}`, size: 18, font: 'Arial', color: '888888' })],
    }));

    msg.textContent = 'Gerando arquivo .docx...';
    await new Promise(x => setTimeout(x, 40));

    // Criar documento
    const doc = new Document({
      styles: {
        default: { document: { run: { font: 'Arial', size: 22 } } },
      },
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        children,
      }],
    });

    const buffer = await Packer.toBlob(doc);
    const nomeArq = `Relatorio_Visita_${String(r.numero).padStart(3,'0')}_${(r.data||'').replace(/-/g,'')}_${(r.localidade||r.obra||'obra').replace(/[^a-zA-Z0-9]/g,'_').slice(0,20)}.docx`;
    downloadBlobIOS(buffer, nomeArq);
    ov.classList.remove('open');
    showAlert('Word exportado com sucesso!', 'ok');
  } catch(err) {
    ov.classList.remove('open');
    console.error(err);
    showAlert('Erro ao gerar Word: ' + err.message, 'err');
  }
}


// ── DOWNLOAD HELPERS ──
function downloadBlobIOS(blob, filename) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  if (isIOS || isSafari) {
    // iOS/Safari: converter para base64 e usar link data URI que o Safari consegue abrir
    const reader = new FileReader();
    reader.onloadend = function() {
      const base64 = reader.result; // data:...;base64,...
      // Criar um link invisível e simular clique — funciona no Safari iOS 15+
      const a = document.createElement('a');
      a.href = base64;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // Fallback: se não baixar em 1s, mostra o modal de compartilhamento
      setTimeout(() => {
        document.body.removeChild(a);
        // Verificar se o download foi iniciado (heurística)
        mostrarModalDownloadIOS(base64, filename);
      }, 800);
    };
    reader.readAsDataURL(blob);
  } else {
    const isAndroid = /android/i.test(navigator.userAgent);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    // No Android, mostrar instrução pois o arquivo vai para Downloads
    if (isAndroid) {
      setTimeout(() => showAlert('Arquivo salvo em Downloads. Abra com Word ou Google Docs.', 'ok'), 800);
    }
  }
}

function mostrarModalDownloadIOS(dataUri, filename) {
  // Cria modal nativo com botão de compartilhar / salvar
  let modal = document.getElementById('modalDownloadIOS');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalDownloadIOS';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(10,20,35,0.7);z-index:800;align-items:flex-end;justify-content:center;padding:0';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px 16px 0 0;padding:24px 20px;width:100%;max-width:480px;box-shadow:0 -8px 40px rgba(0,0,0,0.3)">
        <div style="font-family:var(--font-cond);font-size:16px;font-weight:700;color:var(--steel);margin-bottom:6px">📄 Arquivo Word Gerado</div>
        <div style="font-size:13px;color:var(--ink-light);margin-bottom:20px;line-height:1.5">
          No iPhone/Safari, toque em <strong>"Abrir arquivo"</strong> e depois use o botão 
          <strong>Compartilhar ↗</strong> para escolher onde salvar (Arquivos, Google Drive, etc).
        </div>
        <a id="iosDownloadLink" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;background:var(--ok);color:#fff;border-radius:8px;font-family:var(--font-cond);font-size:15px;font-weight:700;text-decoration:none;margin-bottom:10px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
          Abrir arquivo
        </a>
        <button onclick="fecharModalDownloadIOS()" style="display:flex;align-items:center;justify-content:center;width:100%;padding:12px;background:var(--surface-2);border:none;border-radius:8px;font-family:var(--font-cond);font-size:14px;font-weight:600;color:var(--ink-mid);cursor:pointer">
          Fechar
        </button>
      </div>
    `;
    document.body.appendChild(modal);
  }
  const link = modal.querySelector('#iosDownloadLink');
  link.href = dataUri;
  link.download = filename;
  modal.style.display = 'flex';
}

function fecharModalDownloadIOS() {
  const modal = document.getElementById('modalDownloadIOS');
  if (modal) modal.style.display = 'none';
}


// ═══════════════════════════════════════════════
//  PASTAS
// ═══════════════════════════════════════════════
let pastas = [];
let pastaAtivaId = null; // null = todas

async function carregarPastas() {
  const { data, error } = await supa.from('pastas').select('*').order('nome');
  if (!error) pastas = data || [];
  renderizarPastasBar();
}

function pastasNivel(paiId) {
  return pastas.filter(p => {
    const pai = p.pasta_pai_id || null;
    // Comparar como string para evitar tipo misto (uuid vs null)
    return pai === paiId || String(pai) === String(paiId);
  });
}

function caminhoAte(id) {
  const caminho = [];
  let atual = pastas.find(p => p.id === id);
  while (atual) {
    caminho.unshift(atual);
    atual = pastas.find(p => p.id === atual.pasta_pai_id);
  }
  return caminho;
}

function renderizarPastasBar() {
  const bar = document.getElementById('pastasBar');
  if (!bar) return;

  const nivelAtual = pastasNivel(_pastaPaiAtualId);
  const caminho = _pastaPaiAtualId ? caminhoAte(_pastaPaiAtualId) : [];

  // Breadcrumb
  let breadcrumb = '';
  if (caminho.length > 0) {
    const crumbs = [`<button class="pasta-breadcrumb-item" onclick="navegarPasta(null)">Todos</button>`];
    caminho.forEach((p, i) => {
      crumbs.push(`<span class="pasta-breadcrumb-sep">›</span>`);
      if (i < caminho.length - 1) {
        crumbs.push(`<button class="pasta-breadcrumb-item" onclick="navegarPasta('${p.id}')">${p.nome}</button>`);
      } else {
        crumbs.push(`<span class="pasta-breadcrumb-item atual">${p.nome}</span>`);
      }
    });
    breadcrumb = `<div class="pasta-breadcrumb">${crumbs.join('')}</div>`;
  }

  // Chips — clique único entra na pasta e filtra relatórios
  const chips = nivelAtual.map(p => `
    <button class="pasta-chip ${pastaAtivaId === p.id ? 'ativa' : ''}" onclick="entrarPasta('${p.id}')">
      📁 ${p.nome}
      <span class="pasta-del" onclick="event.stopPropagation();confirmarExcluirPasta('${p.id}','${p.nome.replace(/'/g,"\'")}')" style="position:relative;z-index:2">×</span>
    </button>`).join('');

  const chipsFixos = _pastaPaiAtualId === null ? `
    <button class="pasta-chip ${pastaAtivaId === null ? 'ativa' : ''}" onclick="filtrarPasta(null)">Todos</button>
    <button class="pasta-chip sem-pasta ${pastaAtivaId === 'sem-pasta' ? 'ativa' : ''}" onclick="filtrarPasta('sem-pasta')">Sem pasta</button>
  ` : `
    <button class="pasta-chip" onclick="navegarPasta(null);filtrarPasta(null)">← Início</button>
  `;

  bar.innerHTML = `
    ${breadcrumb}
    <div class="pastas-chips-row">
      ${chipsFixos}
      ${chips}
      <button class="btn-nova-pasta" onclick="abrirModalNovaPasta()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova pasta
      </button>
    </div>`;
}

function filtrarPasta(id) {
  pastaAtivaId = id;
  renderizarPastasBar();
  renderizarLista();
}

function entrarPasta(id) {
  const temFilhos = pastas.some(p => p.pasta_pai_id === id);
  if (temFilhos) {
    // Tem subpastas — só navega, não filtra ainda
    _pastaPaiAtualId = id;
    pastaAtivaId = null;
    renderizarPastasBar();
    renderizarLista();
  } else {
    // Pasta folha — navega e filtra os relatórios
    _pastaPaiAtualId = id;
    pastaAtivaId = id;
    renderizarPastasBar();
    renderizarLista();
  }
}

function navegarPasta(paiId) {
  _pastaPaiAtualId = paiId;
  pastaAtivaId = null;
  renderizarPastasBar();
  renderizarLista();
}

function abrirModalNovaPasta() {
  document.getElementById('inputNovaPasta').value = '';

  // Mostrar onde a pasta será criada
  const titulo = document.getElementById('modalNovaPastaTitulo');
  const info   = document.getElementById('novaPastaLocalInfo');
  if (_pastaPaiAtualId) {
    const pai = pastas.find(p => p.id === _pastaPaiAtualId);
    if (titulo) titulo.textContent = '📁 Nova Subpasta';
    if (info) {
      info.style.display = 'block';
      info.innerHTML = `📂 Será criada dentro de: <strong>${pai?.nome || ''}</strong>`;
    }
  } else {
    if (titulo) titulo.textContent = '📁 Nova Pasta';
    if (info) info.style.display = 'none';
  }

  document.getElementById('modalNovaPasta').classList.add('open');
  setTimeout(() => document.getElementById('inputNovaPasta').focus(), 100);
}

async function criarPasta() {
  const nome = document.getElementById('inputNovaPasta').value.trim();
  if (!nome) return;
  const payload = { nome, criado_por: currentUser?.email };
  if (_pastaPaiAtualId) payload.pasta_pai_id = _pastaPaiAtualId;
  const { data, error } = await supa.from('pastas').insert([payload]).select().single();
  if (error) { showAlert('Erro: ' + error.message, 'err'); return; }
  pastas.push(data);
  pastas.sort((a,b) => a.nome.localeCompare(b.nome));
  fecharModal('modalNovaPasta');
  // Recarregar do banco mantendo o nível atual
  const paiAtual = _pastaPaiAtualId;
  await carregarPastas();
  _pastaPaiAtualId = paiAtual; // garantir que não resetou
  renderizarPastasBar();
  const nivel = paiAtual ? 'Subpasta' : 'Pasta';
  showAlert(`${nivel} "${nome}" criada!`, 'ok');
}

async function confirmarExcluirPasta(id, nome) {
  if (!confirm(`Excluir a pasta "${nome}"? Os relatórios dentro dela não serão excluídos.`)) return;
  const { error } = await supa.from('pastas').delete().eq('id', id);
  if (error) { showAlert('Erro: ' + error.message, 'err'); return; }
  pastas = pastas.filter(p => p.id !== id);
  if (pastaAtivaId === id) pastaAtivaId = null;
  renderizarPastasBar();
  renderizarLista();
  showAlert(`Pasta excluída.`, 'warn');
}

// Mover relatório para pasta
let _moverRelatorioId = null;

async function menuMoverPasta() {
  fecharMenuCard();
  _moverRelatorioId = _menuCardId;
  // Recarregar pastas do banco para garantir dados atualizados
  await carregarPastas();
  const r = relatorios.find(x => x.id === _menuCardId);
  const list = document.getElementById('pastaSelectList');
  list.innerHTML = `
    <button class="pasta-select-item ${!r?.pasta_id ? 'selecionada' : ''}" onclick="moverParaPasta(null)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
      Sem pasta
    </button>
    ${[...pastas].sort((a,b) => {
      const labelA = (a.pasta_pai_id ? (pastas.find(x=>x.id===a.pasta_pai_id)?.nome||'') + ' › ' : '') + a.nome;
      const labelB = (b.pasta_pai_id ? (pastas.find(x=>x.id===b.pasta_pai_id)?.nome||'') + ' › ' : '') + b.nome;
      return labelA.localeCompare(labelB);
    }).map(p => {
      const pai = pastas.find(x => x.id === p.pasta_pai_id);
      const label = pai ? `${pai.nome} › ${p.nome}` : p.nome;
      const indent = pai ? 'padding-left:24px;' : '';
      return `
      <button class="pasta-select-item ${r?.pasta_id === p.id ? 'selecionada' : ''}" onclick="moverParaPasta('${p.id}')" style="${indent}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        ${label}
      </button>`;
    }).join('')}`;
  document.getElementById('pastaSelectOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function fecharPastaSelect() {
  document.getElementById('pastaSelectOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

async function moverParaPasta(pastaId) {
  fecharPastaSelect();
  if (!_moverRelatorioId) return;
  const { error } = await supa.from('relatorios').update({ pasta_id: pastaId }).eq('id', _moverRelatorioId);
  if (error) { showAlert('Erro: ' + error.message, 'err'); return; }
  const r = relatorios.find(x => x.id === _moverRelatorioId);
  if (r) r.pasta_id = pastaId;
  const pastaAlvo = pastaId ? pastas.find(p => p.id === pastaId) : null;
  const paiAlvo = pastaAlvo ? pastas.find(p => p.id === pastaAlvo.pasta_pai_id) : null;
  const nomePasta = pastaAlvo ? (paiAlvo ? `${paiAlvo.nome} › ${pastaAlvo.nome}` : pastaAlvo.nome) : 'sem pasta';
  showAlert(`Movido para: ${nomePasta}`, 'ok');
  renderizarLista();
}


document.getElementById('inputFotoCamera').addEventListener('change', processarFotoInput);
document.getElementById('inputFotoGaleria').addEventListener('change', processarFotoInput);
document.addEventListener('keydown', e => { if(e.key==='Escape') fecharViewerBtn(); });

// ═══════════════════════════════════════════════
//  INIT — VERIFICA SESSÃO
// ═══════════════════════════════════════════════
(async function() {
  const { data: { session } } = await supa.auth.getSession();
  if (session && session.user) {
    aoLogar(session.user);
  }
})();

// ── Ping automático para manter Supabase ativo ──
(function pingSupabase() {
  const INTERVALO = 4 * 24 * 60 * 60 * 1000; // 4 dias
  const CHAVE = 'clemar_ultimo_ping';

  async function ping() {
    try {
      await supa.from('usuarios').select('id').limit(1);
      localStorage.setItem(CHAVE, Date.now().toString());
    } catch(e) {}
  }

  const ultimo = parseInt(localStorage.getItem(CHAVE) || '0');
  if (Date.now() - ultimo > INTERVALO) ping();

  setInterval(ping, INTERVALO);
})();

// Limpar presença ao fechar/recarregar a aba
window.addEventListener('beforeunload', () => {
  if (currentId && currentUser) {
    try { removerPresenca(currentId); } catch(e) {}
  }
});
