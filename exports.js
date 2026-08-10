    // 2. PRÉ-CÁLCULO DAS ALTURAS (Ajustado)
    const rendered = [];
    for (const block of blocks) {
      if (block.getAttribute('data-tipo') === 'foto') {
        rendered.push({ 
          tipo: 'foto', 
          base64: block.getAttribute('data-base64'), 
          w: parseInt(block.getAttribute('data-w')) || 800, 
          h: parseInt(block.getAttribute('data-h')) || 600 
        });
      } else {
        const bc = await html2canvas(block, { 
          scale: 1.8, 
          useCORS: true, 
          backgroundColor: '#ffffff',
          logging: false 
        });
        rendered.push({ 
          tipo: 'canvas', 
          canvas: bc, 
          h: (bc.height * A4w) / bc.width,
          // Verifica se é o bloco de título/descrição das fotos
          isHeaderFoto: block.getAttribute('data-tipo') === 'header-foto'
        });
      }
    }

    // 3. DESENHO NO PDF COM VÍNCULO REFORÇADO
    for (let ri = 0; ri < rendered.length; ri++) {
      const item = rendered[ri];
      if (item.tipo === 'canvas' && item.h < 2) continue;

      let heightToCompare = item.h;

      // --- LÓGICA DE VÍNCULO ---
      // Se este item for um Título de Foto, verificamos se a PRIMEIRA FOTO do grupo cabe junto.
      if (item.isHeaderFoto && rendered[ri + 1]?.tipo === 'foto') {
        const f = rendered[ri + 1];
        
        // Cálculo da escala da foto (exatamente como ela é desenhada no PDF)
        const maxW = A4w * 0.35;
        const maxH = A4h * 0.35;
        const scale = Math.min(maxW / f.w, maxH / f.h);
        const photoH = f.h * scale;

        // Soma: Altura do Texto + Altura da Foto + Margens de segurança (15mm)
        // Aumentamos o "respiro" para 15mm para forçar a quebra mais cedo
        heightToCompare += photoH + 30; 
      }

      // Verifica se o conjunto (Título + Foto) cabe na página
      if (curY + heightToCompare > A4h && curY > margin + 5) {
        pdf.addPage();
        curY = margin;
      }

      // Desenho real
      if (item.tipo === 'foto') {
        const scale = Math.min((A4w * 0.35) / item.w, (A4h * 0.35) / item.h);
        const rW = item.w * scale; 
        const rH = item.h * scale;
        
        pdf.addImage(item.base64, 'JPEG', margin, curY, rW, rH);
        curY += rH + 4; // Avança o Y após a foto
      } else {
        const imgData = item.canvas.toDataURL('image/jpeg', 0.88);
        pdf.addImage(imgData, 'JPEG', margin, curY, A4w, item.h);
        curY += item.h + 2; // Avança o Y após o texto
      }
    }
