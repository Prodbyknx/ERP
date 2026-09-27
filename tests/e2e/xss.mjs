// E2E de XSS GUARDADO: planta código em TODO campo de texto dos dados (nome,
// cliente, observação, categoria, canal, usuário...) — do jeito que um
// usuário mal-intencionado ou um backup adulterado faria — e abre todas as
// abas, fichas, edições e PDFs. Nada pode executar: tudo tem que aparecer
// como texto. Antes da correção a foto do produto executava (src="").
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ABAS = ['dash', 'calc', 'prod', 'sales', 'fil', 'serv', 'clients', 'consig', 'quote', 'rep', 'fin', 'ecom', 'audit', 'users', 'cfg'];

export async function secaoXSS({ b, teste, novaPagina, passo }) {
  console.log('XSS) código plantado nos dados não pode rodar em nenhuma tela');
  const pg = await novaPagina(b);
  pg.on('dialog', d => d.dismiss().catch(() => {}));
  await pg.addInitScript(() => { window.__xss = []; });
  try {
    await passo(pg, 'XSS: código plantado em todos os campos de texto não executa em nenhuma aba, ficha, edição ou PDF', async () => {
      await pg.goto('file://' + teste + '/index.html');
      await pg.waitForFunction(() => typeof showTab === 'function' && localStorage.getItem('teste144_semeado'), null, { timeout: 20000 });
      await pg.evaluate(png => {
        const P = k => 'ZZ"\'><img src=x onerror="(top.__xss=top.__xss||[]).push(\'' + k + '\')"><svg onload="(top.__xss=top.__xss||[]).push(\'' + k + '-svg\')">';
        const L = k => JSON.parse(localStorage.getItem('teste144_' + k) || 'null');
        const S = (k, v) => localStorage.setItem('teste144_' + k, JSON.stringify(v));
        const hoje = new Date().toISOString().slice(0, 10);
        // coleções que o demo não semeia
        S('knx3d_consignments', [{ id: 'k1', numero: 1, data: hoje, clienteId: 'c1', cliente: 'x', cpfCnpj: 'x', whatsapp: 'x', enderecoCompleto: 'x', prazo: 30, obs: 'x', status: 'Ativo',
          itens: [{ prodId: 'p1', nome: 'x', qtd: 2, preco: 19.99, repassePct: 70, vendidos: 0, devolvidos: 0 }], totalVenda: 39.98, totalReceber: 27.99 }]);
        S('knx3d_consig_history', [{ id: 'h1', consigId: 'k1', data: hoje, acao: 'entrega', detalhes: 'x' }]);
        S('knx3d_crm_logs', [{ id: 'l1', clienteId: 'c1', data: hoje, canal: 'WhatsApp', status: 'Ativo', obs: 'x', followUp: hoje }]);
        S('knx3d_prod_log', [{ id: 'g1', data: hoje, prodId: 'p1', nome: 'x', qtd: 2, gramas: 32, filamentId: 'f1', custo: 12 }]);
        const qs = L('knx3d_quotes'); qs.push({ ...qs[0], id: 'o2', numero: 2, prod: undefined }); S('knx3d_quotes', qs);
        // envenena todo texto livre (ids e datas ficam, senão nada se liga)
        const NAO = /^(id|.*Id|data|ts|followUp|sinalEm|abertoEm|entrega|dir|tipo|descTipo|pagamento|acao|status|canal|perfil|cor|foto)$/;
        const envenena = (o, pref) => {
          if (Array.isArray(o)) { o.forEach((x, i) => { if (typeof x === 'string') o[i] = x + P(pref); else envenena(x, pref); }); return; }
          if (!o || typeof o !== 'object') return;
          for (const k of Object.keys(o)) {
            const v = o[k];
            if (typeof v === 'string' && !NAO.test(k) && !/^\d{4}-\d\d-\d\d/.test(v)) o[k] = v + P(pref + '.' + k);
            else if (v && typeof v === 'object' && k !== 'permissoes') envenena(v, pref + '.' + k);
          }
        };
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!/^teste144_knx3d_/.test(k)) continue;
          const v = JSON.parse(localStorage.getItem(k)); envenena(v, k.replace('teste144_knx3d_', '')); localStorage.setItem(k, JSON.stringify(v));
        }
        // campos "de lista" que também aceitam texto livre
        const ex = L('knx3d_expenses'); ex[0].categoria = 'Outro' + P('expenses.categoria'); S('knx3d_expenses', ex);
        const sa = L('knx3d_sales'); sa[0].canal = 'Loja' + P('sales.canal'); sa[0].pagamento = 'Pix' + P('sales.pagamento'); S('knx3d_sales', sa);
        const cl = L('knx3d_crm_logs'); cl[0].canal = 'Tel' + P('crm.canal'); cl[0].status = 'Frio' + P('crm.status'); S('knx3d_crm_logs', cl);
        const fi = L('knx3d_filaments'); fi[0].cor = '#fff"' + P('fil.cor'); S('knx3d_filaments', fi);
        // foto adulterada (fecha o src="") e uma foto de verdade
        const pr = L('knx3d_products'); pr[0].foto = 'x" onerror="(top.__xss=top.__xss||[]).push(\'prod.foto\')'; pr[2].foto = png; S('knx3d_products', pr);
      }, PNG_1PX);
      await pg.reload();
      await pg.waitForFunction(() => typeof showTab === 'function' && typeof Cloud === 'object', null, { timeout: 20000 });
      await pg.waitForTimeout(800);
      // nome e login de usuário vêm do perfil de cada um na nuvem
      await pg.evaluate(() => { const P = k => '"\'><img src=x onerror="(top.__xss=top.__xss||[]).push(\'' + k + '\')">'; Cloud.users[1].nome += P('users.nome'); Cloud.users[1].login += P('users.login'); });
      const fechar = () => pg.evaluate(() => document.querySelectorAll('.modal.active,.modal-bg.active').forEach(m => m.classList.remove('active')));
      for (const t of ABAS) { await pg.evaluate(t => showTab(t), t); await pg.waitForTimeout(250); }
      const ACOES = ['clientFicha("c1")', 'clientUse("c1")', 'loadProduct("p1")', 'moveStock("p1")', 'changeStock("p1")', 'prEdit("1")', 'filEdit("f1")', 'filComprar("f1")', 'svEdit("s1")',
        'quoteProducao("o1")', 'consigManage("k1")', 'consigEdit("k1")', 'userEdit("u2")', 'quotePrint("o2")', 'salePrint("v1")', 'consigPrint("k1")'];
      for (const a of ACOES) {
        await pg.evaluate(a => (0, eval)(a), a);
        await pg.waitForTimeout(/Print/.test(a) ? 4500 : 400);
        await fechar();
      }
      for (const t of ABAS) { await pg.evaluate(t => showTab(t), t); await pg.waitForTimeout(200); }
      const rodou = await pg.evaluate(() => [...new Set(window.__xss)]);
      if (rodou.length) throw new Error('código plantado EXECUTOU em: ' + rodou.join(', '));
      const comoTexto = await pg.evaluate(() => { showTab('prod'); return document.getElementById('view-prod').innerText.includes('<img src=x'); });
      if (!comoTexto) throw new Error('o texto plantado deveria aparecer como texto na aba Produtos');
    });
    await passo(pg, 'XSS: foto de produto de verdade continua aparecendo; a adulterada vira "sem foto"', async () => {
      const r = await pg.evaluate(() => { showTab('prod'); const imgs = [...document.querySelectorAll('#view-prod img')]; return { boas: imgs.filter(i => i.src.startsWith('data:image/png')).length, ruins: imgs.filter(i => !/^data:image\//.test(i.getAttribute('src') || '')).length }; });
      if (r.boas < 1 || r.ruins) throw new Error(JSON.stringify(r));
    });
  } finally {
    await pg.context().close();
  }
}
