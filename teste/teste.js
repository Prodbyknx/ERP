/* =====================================================================
   MODO TESTE — 144 Laboratório 3D
   Este arquivo substitui o cloud.js só nesta pasta.
   Os dados ficam no seu navegador (localStorage). NADA vai pro Supabase.
   Pode clicar em tudo, cadastrar, vender, apagar. Não afeta a produção.
   ===================================================================== */
(function(){
  var K = function(k){ return 'teste144_' + k; };

  var USUARIO  = { id:'u1', nome:'Gabriel (teste)', login:'teste@144', perfil:'ADMIN' };
  var VENDEDOR = { id:'u2', nome:'Ana (vendedora)', login:'ana@144',  perfil:'VENDEDOR' };

  window.Cloud = {
    user: USUARIO,
    users: [ USUARIO, VENDEDOR ],
    load: function(k, fb){
      try { var v = localStorage.getItem(K(k)); return v ? JSON.parse(v) : fb; }
      catch(e){ return fb; }
    },
    save: function(k, v){
      try { localStorage.setItem(K(k), JSON.stringify(v)); } catch(e){}
    },
    local: {
      getItem: function(k){ return localStorage.getItem(K('meta_'+k)); },
      setItem: function(k,v){ try{ localStorage.setItem(K('meta_'+k), v); }catch(e){} }
    },
    deferToast: function(){ return false; },
    logout: function(){
      if(confirm('Apagar os dados de teste e recomeçar do zero?')){
        Object.keys(localStorage).forEach(function(k){
          if(k.indexOf('teste144_') === 0) localStorage.removeItem(k);
        });
      }
      location.reload();
    },
    usersAction: function(){ return Promise.resolve({ ok:true }); },
    exportBackup: function(){ alert('Exportar backup não funciona no modo teste.'); },
    importBackup: function(){ return Promise.resolve(); }
  };

  /* ---------- dados de demonstração, só na primeira abertura ---------- */
  function semear(){
    if(localStorage.getItem(K('semeado'))) return;
    var hoje = new Date().toISOString().slice(0,10);
    var S = Cloud.save;

    S('knx3d_config', {
      negocio:'144 Laboratório 3D',
      cnpj:'69.185.473/0001-07',
      pix:'',
      endereco:'Rio Bonito - RJ',
      whatsapp:'(21) 99960-5907',
      email:'144laboratorio3d@gmail.com',
      kwh:1.07, hora:18, falha:8, margem:60, plat:0,
      taxaML:12, taxaShopee:14, taxaCartao:4
    });

    S('knx3d_printers', [
      { id:1, nome:'Bambu Lab A1', qtd:1, pot:0.1, maq:0.70 }
    ]);

    S('knx3d_filaments', [
      { id:'f1', marca:'F3D',   material:'PLA', cor:'#9aa3b2', corNome:'CINZA',  prkg:112, estoque:2400 },
      { id:'f2', marca:'Bambu', material:'PLA', cor:'#ffffff', corNome:'BRANCO', prkg:140, estoque:150  },
      { id:'f3', marca:'F3D',   material:'PETG',cor:'#111111', corNome:'PRETO',  prkg:129, estoque:850  }
    ]);

    S('knx3d_products', [
      { id:'p1', nome:'Chaveiro Cabeça de Dragão', categoria:'Chaveiro',   gramas:16.3, horas:0, min:42,
        custo:6.19,  preco:19.99, margem:60, plataforma:0, estoque:5,
        locais:{oficina:4, ml:1, shopee:0}, filamentId:'f1', printerId:1, ativo:true, foto:'' },
      { id:'p2', nome:'Suporte de Headset Gamer',  categoria:'Suportes',   gramas:82,   horas:4, min:10,
        custo:18.40, preco:69.90, margem:60, plataforma:0, estoque:3,
        locais:{oficina:3, ml:0, shopee:0}, filamentId:'f1', printerId:1, ativo:true, foto:'' },
      { id:'p3', nome:'Vaso Geométrico Médio',     categoria:'Decoração',  gramas:120,  horas:6, min:0,
        custo:24.90, preco:89.90, margem:60, plataforma:0, estoque:2,
        locais:{oficina:2, ml:0, shopee:0}, filamentId:'f2', printerId:1, ativo:true, foto:'' },
      { id:'p4', nome:'Organizador de Bancada',    categoria:'Organização',gramas:210,  horas:9, min:15,
        custo:41.20, preco:139.90, margem:60, plataforma:0, estoque:1,
        locais:{oficina:1, ml:0, shopee:0}, filamentId:'f3', printerId:1, ativo:true, foto:'' }
    ]);

    S('knx3d_sales', [
      { id:'v1', prodId:'p1', nome:'Chaveiro Cabeça de Dragão', qtd:2, precoUnit:19.99, custoUnit:6.19,
        data:hoje, canal:'Presencial',    taxaPlat:0,  taxaCartao:0, descontoValor:0, pagamento:'Pix' },
      { id:'v2', prodId:'p2', nome:'Suporte de Headset Gamer',  qtd:1, precoUnit:69.90, custoUnit:18.40,
        data:hoje, canal:'Shopee',        taxaPlat:14, taxaCartao:0, descontoValor:0, pagamento:'Pix' },
      { id:'v3', prodId:'p3', nome:'Vaso Geométrico Médio',     qtd:1, precoUnit:89.90, custoUnit:24.90,
        data:hoje, canal:'Mercado Livre', taxaPlat:12, taxaCartao:0, descontoValor:0, pagamento:'Pix' }
    ]);

    S('knx3d_clients', [
      { id:'c1', nome:'Move District', whatsapp:'(21) 99510-6378', cidade:'Rio Bonito, RJ',
        email:'contato@movedistrict.com' },
      { id:'c2', nome:'Head Store',    whatsapp:'(21) 97285-2903', cidade:'Rio Bonito, RJ', email:'' }
    ]);

    // um pedido de exemplo ja em producao, entrega em 2 dias
    var d2 = new Date(Date.now() + 2*86400000).toISOString().slice(0,10);
    var d9 = new Date(Date.now() - 9*86400000).toISOString().slice(0,10);
    S('knx3d_quotes', [
      { id:'o1', numero:1, clienteId:'c1', cliente:'Move District', data:d9, validade:15,
        cpfCnpj:'', whatsapp:'(21) 99510-6378', contato:'', enderecoCompleto:'',
        itens:[{ prodId:'p4', nome:'Organizador de Bancada', qtd:8, preco:139.90 }],
        descTipo:'perc', descVal:0, obs:'', subtotal:1119.2, descontoValor:0, total:1119.2,
        prod:{ entrega:d2, sinal:559.60, sinalEm:d9, sinalPago:true, entregue:false,
               abertoEm:d9, obs:'cliente busca na oficina' } }
    ]);

    S('knx3d_services', [
      { id:'s1', nome:'Modelagem 3D sob medida', preco:180, descInterna:'até 3 revisões' }
    ]);

    S('knx3d_expenses', [
      { id:'e1', data:hoje, categoria:'Filamento',  descricao:'Compra F3D CINZA', valor:112 },
      { id:'e2', data:hoje, categoria:'Embalagem',  descricao:'Sacos ziplock',    valor:14.9 }
    ]);

    // permissões de exemplo da vendedora (ficam dentro do config)
    var c = Cloud.load('knx3d_config', {});
    c.permissoes = { u2: ['dash','calc','quote','sales','prod','clients','assistente'] };
    S('knx3d_config', c);

    // carimba o autor nos dados de exemplo
    ['knx3d_products','knx3d_sales','knx3d_expenses','knx3d_clients','knx3d_filaments'].forEach(function(k){
      var arr = Cloud.load(k, []);
      arr.forEach(function(o, i){
        var u = (i % 3 === 0) ? VENDEDOR : USUARIO;
        o.usuarioId = u.id; o.usuarioNome = u.nome;
      });
      S(k, arr);
    });

    // trilha de atividade de exemplo
    var agora = Date.now();
    var trilha = [
      ['criou','Filamento','F3D CINZA',112, USUARIO, 6],
      ['criou','Produto','Chaveiro Cabeça de Dragão',19.99, USUARIO, 5],
      ['criou','Produto','Vaso Geométrico Médio',89.9, USUARIO, 5],
      ['registrou','Venda','Chaveiro Cabeça de Dragão — 2 un. (Presencial)',39.98, VENDEDOR, 3],
      ['registrou','Venda','Suporte de Headset Gamer — 1 un. (Shopee)',69.9, VENDEDOR, 2],
      ['lançou','Despesa','Embalagem — Sacos ziplock',14.9, USUARIO, 2],
      ['criou','Cliente','Move District','', VENDEDOR, 1],
      ['registrou','Contato (CRM)','Pediu orçamento de 50 chaveiros','', VENDEDOR, 1]
    ].map(function(t, i){
      return { id:'a'+i, ts:new Date(agora - t[5]*3600000 - i*900000).toISOString(),
               usuarioId:t[4].id, usuario:t[4].nome, acao:t[0], alvo:t[1], detalhe:t[2], valor:t[3] };
    });
    S('knx3d_audit', trilha);

    localStorage.setItem(K('semeado'), '1');
  }

  /* ---------- sobe direto, sem tela de login ---------- */
  window.addEventListener('DOMContentLoaded', function(){
    semear();

    var login = document.getElementById('login-screen');
    if(login){ login.classList.remove('active'); login.style.display = 'none'; }

    var app = document.getElementById('app-wrapper');
    if(app) app.style.display = 'block';

    var s = document.createElement('script');
    s.src = 'app.js';
    s.onload = function(){
      try { if(window.ERP_APP && window.ERP_APP.afterLogin) window.ERP_APP.afterLogin(); } catch(e){}
      var faixa = document.createElement('div');
      faixa.textContent = 'MODO TESTE — dados só neste navegador, nada vai pro Supabase';
      faixa.style.cssText = 'position:fixed; right:14px; bottom:14px; z-index:999;'
        + 'background:#17140f; color:#fff; font:600 10.5px/1.3 Inter, system-ui, sans-serif;'
        + 'letter-spacing:.06em; text-transform:uppercase; padding:8px 13px; border-radius:99px;'
        + 'box-shadow:0 8px 24px -10px rgba(0,0,0,.45); opacity:.92; pointer-events:none; max-width:70vw;';
      document.body.appendChild(faixa);
    };
    document.body.appendChild(s);
  });
})();
