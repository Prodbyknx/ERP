// CSS do Estúdio 3D. Usa as variáveis do ERP (--brand, --line, --panel...),
// então segue sozinho o tema claro/escuro do sistema.
export const CSS = `
.e3d{ --e3d-r:14px; --e3d-r-sm:10px;
  --e3d-vidro:color-mix(in srgb, var(--panel) 80%, transparent);
  --e3d-borda-vidro:color-mix(in srgb, var(--line) 85%, transparent);
  --e3d-sombra:0 10px 30px -14px rgba(10,12,16,.35), 0 2px 6px -2px rgba(10,12,16,.10);
  --e3d-fundo-a:#f3f4f6; --e3d-fundo-b:#dfe3e8;
  position:relative; display:grid; grid-template-rows:auto minmax(0,1fr);
  height:clamp(600px, calc(100vh - 150px), 1400px);
  background:var(--panel); border:1px solid var(--line); border-radius:18px; overflow:hidden;
  box-shadow:var(--shadow-md); font-family:var(--sans); color:var(--ink) }
html[data-tema=escuro] .e3d{ --e3d-fundo-a:#20242b; --e3d-fundo-b:#121418;
  --e3d-sombra:0 12px 34px -12px rgba(0,0,0,.7), 0 2px 6px -2px rgba(0,0,0,.4) }
.e3d:fullscreen{ height:100vh; border-radius:0; border:0 }
.e3d *{ box-sizing:border-box }
.e3d svg{ flex:0 0 auto }

/* ---------- barra de cima ---------- */
.e3d-top{ display:flex; align-items:center; gap:10px; padding:8px 12px; border-bottom:1px solid var(--line); background:var(--panel); min-width:0 }
.e3d-marca{ display:flex; align-items:center; gap:9px; font:700 14px var(--sans); color:var(--ink); padding-right:6px; white-space:nowrap }
.e3d-marca i{ width:30px; height:30px; border-radius:9px; background:linear-gradient(135deg, var(--brand), #ff8a3d); color:#fff;
  display:inline-flex; align-items:center; justify-content:center; box-shadow:0 6px 14px -6px rgba(229,76,0,.7) }
.e3d-grupo{ display:flex; align-items:center; gap:2px; padding:3px; border-radius:12px; background:var(--bg-2) }
.e3d-top .grow{ flex:1 }
.e3d-bt{ display:inline-flex; align-items:center; gap:7px; height:34px; padding:0 11px; border-radius:9px; border:0; background:none;
  color:var(--ink-soft); font:600 12.5px var(--sans); cursor:pointer; white-space:nowrap; transition:background .15s, color .15s }
.e3d-bt:hover:not(:disabled){ background:var(--panel); color:var(--ink) }
.e3d-top > .e3d-bt:hover:not(:disabled){ background:var(--bg-2) }
.e3d-bt:disabled{ opacity:.38; cursor:default }
.e3d-bt.ativo{ background:var(--panel); color:var(--brand); box-shadow:0 1px 3px rgba(0,0,0,.12) }
.e3d-bt.primario{ background:var(--brand); color:#fff; padding:0 14px; box-shadow:0 6px 16px -8px rgba(229,76,0,.8) }
.e3d-bt.primario:hover{ background:var(--amber-2); color:#fff }
.e3d-bt.so-ico{ width:34px; padding:0; justify-content:center }
.e3d-motor{ display:inline-flex; align-items:center; gap:7px; height:30px; padding:0 11px; border-radius:99px; background:var(--bg-2);
  font:600 11.5px var(--sans); color:var(--ink-dim); white-space:nowrap }
.e3d-motor i{ width:8px; height:8px; border-radius:50%; background:#9ca3af }
.e3d-motor.ok i{ background:#16a34a; box-shadow:0 0 0 3px rgba(22,163,74,.18) }
.e3d-motor.ocupado i{ background:#f59e0b; animation:e3dpulsa 1s infinite }
@keyframes e3dpulsa{ 50%{ opacity:.35 } }

/* ---------- corpo: trilho | palco | painel ---------- */
.e3d-main{ display:grid; grid-template-columns:80px minmax(0,1fr) 370px; min-height:0 }
.e3d-rail{ display:flex; flex-direction:column; gap:4px; padding:10px 8px; border-right:1px solid var(--line); background:var(--panel-2); overflow:auto }
.e3d-rail button{ display:flex; flex-direction:column; align-items:center; gap:5px; padding:10px 2px 9px; border-radius:12px; border:0; background:none;
  color:var(--ink-soft); font:600 11px/1.1 var(--sans); cursor:pointer; transition:background .15s, color .15s; position:relative }
.e3d-rail button svg{ width:22px; height:22px }
.e3d-rail button:hover{ background:var(--line-soft); color:var(--ink) }
.e3d-rail button.ativo{ background:var(--brand-soft); color:var(--brand) }
.e3d-rail button.ativo::before{ content:''; position:absolute; left:-8px; top:12px; bottom:12px; width:3px; border-radius:0 3px 3px 0; background:var(--brand) }
.e3d-rail hr{ border:0; border-top:1px solid var(--line); margin:4px 8px }

.e3d-palco{ position:relative; overflow:hidden; min-height:0;
  background:radial-gradient(120% 90% at 50% 0%, var(--e3d-fundo-a), var(--e3d-fundo-b)) }
.e3d-canvas{ display:block; width:100%; height:100%; outline:none; touch-action:none }
.e3d-palco.sobre::after{ content:'Solte o arquivo aqui'; position:absolute; inset:14px; border:2px dashed var(--brand); border-radius:16px;
  display:flex; align-items:center; justify-content:center; font:700 16px var(--sans); color:var(--brand); background:color-mix(in srgb, var(--brand) 8%, transparent); z-index:9 }

.e3d-vidro{ background:var(--e3d-vidro); -webkit-backdrop-filter:blur(14px) saturate(1.3); backdrop-filter:blur(14px) saturate(1.3);
  border:1px solid var(--e3d-borda-vidro); border-radius:var(--e3d-r); box-shadow:var(--e3d-sombra) }

/* vazio */
.e3d-vazio{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:24px; pointer-events:none }
.e3d-vazio .caixa{ pointer-events:auto; max-width:440px; width:100%; text-align:center; padding:30px 26px; border-radius:20px;
  border:2px dashed color-mix(in srgb, var(--ink-dim) 45%, transparent); background:var(--e3d-vidro); -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px) }
.e3d-vazio .ico{ width:58px; height:58px; margin:0 auto 12px; border-radius:16px; background:var(--brand-soft); color:var(--brand); display:flex; align-items:center; justify-content:center }
.e3d-vazio h3{ margin:0 0 6px; font:700 18px var(--sans); color:var(--ink) }
.e3d-vazio p{ margin:0 0 16px; font-size:13px; color:var(--ink-soft); line-height:1.5 }
.e3d-vazio .formatos{ display:flex; gap:6px; justify-content:center; margin-top:14px; flex-wrap:wrap }
.e3d-vazio .formatos span{ font:600 10.5px var(--mono); padding:3px 8px; border-radius:99px; background:var(--bg-2); color:var(--ink-soft) }

/* cartão de objetos (flutua no canto) */
.e3d-objetos{ position:absolute; left:12px; top:12px; width:250px; max-height:calc(100% - 90px); display:flex; flex-direction:column; z-index:3; overflow:hidden }
.e3d-objetos.recolhido{ width:auto }
.e3d-objetos-cab{ display:flex; align-items:center; gap:8px; padding:9px 10px 9px 12px; cursor:pointer; font:700 12px var(--sans); color:var(--ink); user-select:none }
.e3d-objetos-cab .qtd{ font:600 11px var(--mono); color:var(--ink-dim); background:var(--bg-2); border-radius:99px; padding:1px 7px }
.e3d-objetos-cab .seta{ margin-left:auto; color:var(--ink-dim); transition:transform .2s }
.e3d-objetos.recolhido .seta{ transform:rotate(-90deg) }
.e3d-objetos-lista{ overflow:auto; padding:0 8px 8px }
.e3d-objetos.recolhido .e3d-objetos-lista{ display:none }
.e3d-obj{ border-radius:10px; margin-bottom:4px; border:1px solid transparent }
.e3d-obj.sel{ background:color-mix(in srgb, var(--brand) 9%, transparent); border-color:color-mix(in srgb, var(--brand) 40%, transparent) }
.e3d-obj-cab{ display:flex; align-items:center; gap:6px; padding:6px 6px 6px 8px; cursor:pointer; font:600 12.5px var(--sans); border-radius:10px }
.e3d-obj-cab:hover{ background:var(--line-soft) }
.e3d-obj.sel .e3d-obj-cab:hover{ background:transparent }
.e3d-obj-cab .nome{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.e3d-obj-cab .med{ font:500 10.5px var(--mono); color:var(--ink-dim); white-space:nowrap }
.e3d-ico{ border:0; background:none; cursor:pointer; color:var(--ink-dim); width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; font-size:13px; line-height:1; border-radius:7px; padding:0 }
.e3d-ico:hover{ color:var(--ink); background:var(--line-soft) }
.e3d-obj .e3d-ico{ opacity:0; transition:opacity .15s }
.e3d-obj:hover .e3d-ico, .e3d-obj.sel .e3d-ico{ opacity:1 }
.e3d-parte{ display:flex; align-items:center; gap:7px; padding:5px 8px 5px 14px; font-size:12px; cursor:pointer; color:var(--ink-soft); border-radius:8px }
.e3d-parte:hover{ background:var(--line-soft) }
.e3d-parte.sel{ color:var(--ink); font-weight:600 }
.e3d-parte .nome{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.e3d-bola{ width:14px; height:14px; border-radius:50%; border:1px solid rgba(0,0,0,.18); flex:0 0 auto; box-shadow:inset 0 0 0 1px rgba(255,255,255,.25) }
.e3d-objetos .e3d-botoes{ margin:6px 0 0; gap:4px }
.e3d-objetos .e3d-botoes .btn{ font-size:11.5px; padding:5px 8px; border-radius:8px }

/* saúde do modelo (canto direito) */
.e3d-saude{ position:absolute; right:12px; top:12px; z-index:3; display:none; align-items:center; gap:8px; padding:8px 12px; font:600 12px var(--sans); cursor:pointer; color:var(--ink) }
.e3d-saude.on{ display:flex }
.e3d-saude i{ width:22px; height:22px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; color:#fff; font-style:normal; font-size:12px }
.e3d-saude.bom i{ background:#16a34a } .e3d-saude.atencao i{ background:#f59e0b } .e3d-saude.ruim i{ background:#dc2626 } .e3d-saude.medindo i{ background:#9ca3af }
.e3d-saude:hover{ transform:translateY(-1px) }

/* controles de vista (canto de baixo) */
.e3d-vistas{ position:absolute; left:12px; bottom:12px; z-index:3; display:flex; align-items:center; gap:2px; padding:4px }
.e3d-vistas .e3d-bt{ height:32px; padding:0 9px; font-size:12px }
.e3d-vistas .e3d-bt:hover{ background:var(--line-soft) }
.e3d-vistas .sep{ width:1px; height:20px; background:var(--line); margin:0 4px }
.e3d-vistas select{ height:32px; border:0; background:transparent; font:600 12px var(--sans); color:var(--ink-soft); padding:0 6px; width:auto; cursor:pointer; border-radius:8px }
.e3d-vistas select:hover{ background:var(--line-soft) }
.e3d-vistas label.chip{ display:inline-flex; align-items:center; gap:5px; height:32px; padding:0 9px; border-radius:9px; font:600 12px var(--sans); color:var(--ink-soft); cursor:pointer; margin:0 }
.e3d-vistas label.chip:hover{ background:var(--line-soft) }
.e3d-vistas label.chip input{ position:absolute; opacity:0; pointer-events:none }
.e3d-vistas label.chip:has(input:checked){ background:var(--brand-soft); color:var(--brand) }

.e3d-hud{ position:absolute; left:12px; bottom:62px; z-index:2; font:600 11.5px var(--mono); color:var(--ink-soft);
  padding:6px 11px; pointer-events:none; white-space:nowrap; max-width:calc(100% - 24px); overflow:hidden; text-overflow:ellipsis }
.e3d-dica{ position:absolute; right:12px; top:62px; z-index:2; font:500 11.5px var(--sans); color:var(--ink-soft); pointer-events:none; padding:6px 10px; max-width:min(300px, 40%); text-align:right }

/* prévia (confirmar/cancelar) */
.e3d-bt.destaque{ color:var(--accent,#e54c00); font-weight:700 }
.e3d-preparar{ position:absolute; right:12px; top:56px; z-index:7; width:min(380px, calc(100% - 24px)); max-height:calc(100% - 80px); overflow:auto; padding:12px 14px; display:flex; flex-direction:column; gap:8px }
.e3d-preparar .tp{ display:flex; align-items:center; justify-content:space-between }
.e3d-preparar .tp b{ font-size:15px }
.e3d-preparar .lst{ display:flex; flex-direction:column; gap:6px }
.e3d-preparar .it{ display:flex; gap:10px; align-items:flex-start; padding:8px; border-radius:10px; background:var(--bg-soft, rgba(127,127,127,.08)) }
.e3d-preparar .it i{ flex:none; width:22px; height:22px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; color:#fff; font-style:normal; font-size:12px; font-weight:700; background:#8a8f98 }
.e3d-preparar .it.bom i{ background:#1a7f37 } .e3d-preparar .it.atencao i{ background:#d97706 } .e3d-preparar .it.erro i{ background:#d1242f } .e3d-preparar .it.dica i{ background:#1f6feb }
.e3d-preparar .it div{ display:flex; flex-direction:column; gap:2px; min-width:0 }
.e3d-preparar .it b{ font-size:13px } .e3d-preparar .it span{ font-size:12px; color:var(--ink-soft) }
.e3d-preparar .it .btn{ align-self:flex-start; margin-top:4px }
.e3d-preparar .pe{ display:flex; flex-direction:column; gap:8px; margin-top:4px }
.e3d-preparar .res{ font-weight:700; font-size:14px } .e3d-preparar .res.bom{ color:#1a7f37 } .e3d-preparar .res.atencao{ color:#b45309 }
.e3d-previa{ position:absolute; left:50%; top:14px; transform:translateX(-50%); z-index:6; padding:10px 12px 10px 16px; display:flex; gap:12px; align-items:center;
  font:600 13px var(--sans); max-width:calc(100% - 300px); flex-wrap:wrap; animation:e3dentra .22s var(--ease) }
.e3d-previa .leg{ display:flex; gap:10px; color:var(--ink-soft); font-size:12px; flex-wrap:wrap; font-weight:500 }
.e3d-previa .leg span::before{ content:''; display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:5px; vertical-align:-1px; background:var(--c) }
.e3d-previa .btn{ border-radius:10px; height:36px; padding:0 14px }
@keyframes e3dentra{ from{ opacity:0; transform:translate(-50%, -6px) } }

/* calculando */
.e3d-ocupado{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:7; display:none; align-items:center; gap:12px; padding:14px 16px 14px 14px; font:600 13px var(--sans); color:var(--ink) }
.e3d-ocupado.on{ display:flex; animation:e3dsurge .2s var(--ease) }
.e3d-ocupado .roda{ width:26px; height:26px; border-radius:50%; border:3px solid var(--line); border-top-color:var(--brand); animation:e3dgira .8s linear infinite }
.e3d-ocupado small{ display:block; font:500 11.5px var(--mono); color:var(--ink-dim); margin-top:2px }
.e3d-ocupado .btn{ height:30px; padding:0 10px; font-size:12px; border-radius:8px; margin-left:4px }
@keyframes e3dgira{ to{ transform:rotate(360deg) } }
@keyframes e3dsurge{ from{ opacity:0; transform:translate(-50%,-46%) } }

/* ---------- painel da direita ---------- */
.e3d-painel{ display:flex; flex-direction:column; min-height:0; border-left:1px solid var(--line); background:var(--panel) }
.e3d-painel-cab{ padding:18px 20px 12px; border-bottom:1px solid var(--line-soft) }
.e3d-painel-cab .rot{ display:flex; align-items:center; gap:10px }
.e3d-painel-cab .rot i{ width:34px; height:34px; border-radius:10px; background:var(--brand-soft); color:var(--brand); display:inline-flex; align-items:center; justify-content:center }
.e3d-painel-cab h3{ margin:0; font:700 16.5px var(--sans); color:var(--ink); letter-spacing:-.01em }
.e3d-painel-cab p{ margin:8px 0 0; font-size:12.5px; line-height:1.5; color:var(--ink-soft) }
.e3d-painel-corpo{ flex:1; overflow:auto; padding:14px 20px 22px; scroll-behavior:smooth }
.e3d-painel details:not([open]){ display:none }
.e3d-painel details > summary{ display:none }
.e3d-painel.inicio details{ display:none }
.e3d-inicio{ display:none }
.e3d-painel.inicio .e3d-inicio{ display:block }

/* início: sugestões + tarefas */
.e3d-bloco-tit{ font:700 11px/1.2 var(--sans); letter-spacing:.07em; text-transform:uppercase; color:var(--ink-dim); margin:4px 0 10px }
.e3d-sugestoes{ display:flex; flex-direction:column; gap:8px; margin-bottom:20px }
.e3d-sug{ display:flex; align-items:center; gap:11px; padding:11px 12px; border-radius:12px; border:1px solid var(--line); background:var(--panel-2) }
.e3d-sug i{ width:30px; height:30px; border-radius:9px; display:inline-flex; align-items:center; justify-content:center; font-style:normal; flex:0 0 auto }
.e3d-sug.ruim i{ background:var(--red-soft); color:var(--red) } .e3d-sug.atencao i{ background:var(--warn-soft); color:var(--warn) }
.e3d-sug.bom i{ background:var(--green-soft); color:var(--green) } .e3d-sug.dica i{ background:var(--brand-soft); color:var(--brand) }
.e3d-sug .txt{ flex:1; min-width:0; font-size:12.5px; line-height:1.35; color:var(--ink-soft) }
.e3d-sug .txt b{ display:block; color:var(--ink); font-size:13px; margin-bottom:1px }
.e3d-sug .btn{ flex:0 0 auto; height:32px; padding:0 12px; font-size:12px; border-radius:9px }
.e3d-tarefas{ display:grid; grid-template-columns:1fr 1fr; gap:8px }
.e3d-tarefa{ display:flex; flex-direction:column; align-items:flex-start; gap:8px; padding:13px 12px 12px; border-radius:14px; border:1px solid var(--line);
  background:var(--panel); cursor:pointer; text-align:left; font-family:var(--sans); color:var(--ink); transition:border-color .15s, box-shadow .15s, transform .15s }
.e3d-tarefa:hover{ border-color:color-mix(in srgb, var(--brand) 55%, var(--line)); box-shadow:0 8px 20px -14px rgba(229,76,0,.6); transform:translateY(-1px) }
.e3d-tarefa i{ width:34px; height:34px; border-radius:10px; background:var(--bg-2); color:var(--ink-soft); display:inline-flex; align-items:center; justify-content:center; transition:background .15s, color .15s }
.e3d-tarefa:hover i{ background:var(--brand-soft); color:var(--brand) }
.e3d-tarefa b{ font:700 12.5px/1.25 var(--sans) }
.e3d-tarefa span{ font:500 11.5px/1.35 var(--sans); color:var(--ink-dim) }
.e3d-tarefa:disabled{ opacity:.45; cursor:default; transform:none; box-shadow:none; border-color:var(--line) }

/* ---------- conteúdo dos quadros ---------- */
.e3d-sec{ padding:0 }
.e3d-sec p.u, .e3d-sec .u{ font-size:12.5px; color:var(--ink-soft); line-height:1.5 }
.e3d-sec .field{ margin-bottom:12px }
.e3d-sec .field > label, .e3d-sec label{ font:600 12px var(--sans); color:var(--ink-soft); margin-bottom:5px }
.e3d-sec input[type=number], .e3d-sec input[type=text], .e3d-sec select{ height:38px; font-size:13px; padding:0 11px; border-radius:var(--e3d-r-sm);
  background:var(--panel); border:1px solid var(--line); color:var(--ink); transition:border-color .15s, box-shadow .15s }
.e3d-sec input[type=number]:focus, .e3d-sec input[type=text]:focus, .e3d-sec select:focus, .e3d-sec textarea:focus{ outline:0; border-color:var(--brand); box-shadow:0 0 0 3px color-mix(in srgb, var(--brand) 18%, transparent) }
.e3d-sec textarea{ height:auto; min-height:56px; padding:9px 11px; width:100%; border:1px solid var(--line); border-radius:var(--e3d-r-sm); font:500 14px var(--sans); resize:vertical; background:var(--panel); color:var(--ink) }
.e3d-l3{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px }
.e3d-l2{ display:grid; grid-template-columns:repeat(2,1fr); gap:8px }
.e3d-l3 label, .e3d-l2 label{ font:600 11px var(--sans); color:var(--ink-dim); display:block; margin-bottom:4px }
.e3d-l3 input, .e3d-l2 input{ width:100% }
.e3d-botoes{ display:flex; flex-wrap:wrap; gap:6px; margin-top:12px }
.e3d-sec .btn{ border-radius:var(--e3d-r-sm); padding:8px 12px; font-size:12.5px; transition:background .15s, border-color .15s, transform .1s }
.e3d-sec .btn:active{ transform:translateY(1px) }
.e3d-sec .btn.primary{ box-shadow:0 8px 18px -10px rgba(229,76,0,.8) }
.e3d-botoes .btn.largo{ flex:1 1 100%; height:44px; font-size:14px; border-radius:12px }
.e3d-sec .btn.mini{ padding:5px 10px; font-size:12px }
.e3d-ops .e3d-op{ display:flex; align-items:center; gap:6px; padding:5px 0; border-bottom:1px solid var(--line-soft); font-size:13px }
.e3d-ops .e3d-op > span:first-child{ flex:1 }
.e3d-ops .e3d-op input{ width:64px }
.e3d-ops .e3d-op.erro > span:first-child{ color:var(--danger, #c62828) }
.e3d-sec .seg{ display:flex; flex-wrap:wrap; gap:2px; padding:3px; margin-bottom:10px; border-radius:12px; background:var(--bg-2); border:0 }
.e3d-sec .seg button{ flex:1 1 auto; padding:7px 10px; font:600 12px var(--sans); border:0; border-radius:9px; background:none; color:var(--ink-soft); cursor:pointer }
.e3d-sec .seg button:hover{ color:var(--ink) }
.e3d-sec .seg button.active{ background:var(--panel); color:var(--ink); box-shadow:0 1px 3px rgba(0,0,0,.14) }
.e3d-titulo{ font:700 11px/1.2 var(--sans); letter-spacing:.07em; text-transform:uppercase; color:var(--ink-dim); margin:6px 0 10px }
.e3d-diag{ display:grid; grid-template-columns:1fr auto; gap:5px 10px; font-size:12.5px; margin:6px 0; padding:12px 14px; border-radius:12px; background:var(--panel-2); border:1px solid var(--line-soft) }
.e3d-diag span{ color:var(--ink-soft) }
.e3d-diag b{ font-family:var(--mono); font-variant-numeric:tabular-nums; text-align:right }
.e3d-diag .bom{ color:var(--green) } .e3d-diag .ruim{ color:var(--red) } .e3d-diag .atencao{ color:var(--warn) }
.e3d-diag .grupo{ grid-column:1/-1; font:700 10.5px var(--sans); text-transform:uppercase; letter-spacing:.07em; color:var(--ink-dim); margin-top:8px }
.e3d-diag .grupo:first-child{ margin-top:0 }
.e3d-nota{ background:var(--panel-2); border:1px solid var(--line); border-radius:12px; padding:10px 12px; font-size:12.5px; color:var(--ink-soft); margin-top:10px; line-height:1.5 }
.e3d-nota.aviso{ background:var(--warn-soft); border-color:color-mix(in srgb, var(--warn) 30%, transparent); color:var(--warn) }
.e3d-nota.erro{ background:var(--red-soft); border-color:color-mix(in srgb, var(--red) 30%, transparent); color:var(--red) }
.e3d-nota.ok{ background:var(--green-soft); border-color:color-mix(in srgb, var(--green) 30%, transparent); color:var(--green) }
.e3d-swatches{ display:flex; flex-wrap:wrap; gap:7px; margin-top:8px }
.e3d-swatches button{ width:28px; height:28px; border-radius:50%; border:2px solid var(--panel); box-shadow:0 0 0 1px var(--line); cursor:pointer; padding:0; transition:transform .12s }
.e3d-swatches button:hover{ transform:scale(1.14) }
.e3d-partes-lista{ display:flex; flex-direction:column; gap:4px; margin-top:8px; max-height:220px; overflow:auto }
.e3d-partes-lista div{ display:flex; align-items:center; gap:6px; font-size:12.5px; padding:5px 7px; border-radius:8px; cursor:pointer }
.e3d-partes-lista div:hover{ background:var(--line-soft) }
.e3d-partes-lista input{ height:26px; font-size:12px; padding:0 6px; flex:1; min-width:0 }
.e3d-slider{ display:flex; align-items:center; gap:10px }
.e3d-slider input[type=range]{ flex:1; accent-color:var(--brand); height:4px }
.e3d-slider input[type=text], .e3d-slider input[type=number]{ width:92px; text-align:right; font-family:var(--mono) }
.e3d-slider b{ font:600 12px var(--mono); color:var(--ink-soft); min-width:44px; text-align:right }
.e3d-cores-hex{ font:500 11px var(--mono); color:var(--ink-dim) }
.e3d-sec .fer-check{ display:flex; align-items:center; gap:8px; font-weight:500; color:var(--ink-soft); cursor:pointer }
.e3d-posbotoes{ display:flex; gap:6px; margin-top:8px }
.e3d-posbotoes .btn{ flex:1 }
.e3d-dicacorte{ display:flex; flex-direction:column; gap:3px; margin-top:10px; padding:10px 12px; border-radius:12px; background:color-mix(in srgb, #1f6feb 8%, transparent);
  border:1px solid color-mix(in srgb, #1f6feb 22%, transparent); font-size:12px; color:var(--ink-soft) }
.e3d-dicacorte b{ color:var(--ink) }
.e3d-secao{ margin-top:8px; font-size:12.5px; color:var(--ink-soft) }
.e3d-secao b{ color:var(--ink); font-family:var(--mono) }
.e3d-secao .aviso{ color:var(--warn) }

/* ---------- telas menores ---------- */
@media (max-width:1180px){
  .e3d-main{ grid-template-columns:72px minmax(0,1fr) 320px }
  .e3d-top .rot-lg{ display:none }
}
@media (max-width:900px){
  .e3d{ height:auto }
  .e3d-main{ grid-template-columns:1fr; grid-template-rows:auto 60vh auto }
  .e3d-rail{ flex-direction:row; border-right:0; border-bottom:1px solid var(--line); overflow-x:auto; padding:6px }
  .e3d-rail button{ min-width:70px }
  .e3d-rail button.ativo::before{ display:none }
  .e3d-rail hr{ display:none }
  .e3d-painel{ border-left:0; border-top:1px solid var(--line) }
  .e3d-painel-corpo{ overflow:visible }
  .e3d-top{ flex-wrap:wrap }
  .e3d-marca span, .e3d-top .rot{ display:none }
  .e3d-objetos{ width:210px }
  .e3d-previa{ max-width:calc(100% - 24px) }
  .e3d-hud, .e3d-dica{ display:none }
}
/* ---------- formas, propriedades, seleção múltipla ---------- */
.e3d-formas{ display:grid; grid-template-columns:repeat(3, 1fr); gap:6px }
.e3d-forma{ display:flex; flex-direction:column; align-items:center; gap:5px; padding:10px 4px 8px; border-radius:12px; border:1px solid var(--line);
  background:var(--panel); color:var(--ink-soft); cursor:pointer; font:600 11px/1.15 var(--sans); text-align:center; transition:border-color .15s, color .15s, transform .12s }
.e3d-forma:hover{ border-color:color-mix(in srgb, var(--brand) 55%, var(--line)); color:var(--brand); transform:translateY(-1px) }
.e3d-props{ padding:12px 14px; border-radius:14px; border:1px solid color-mix(in srgb, var(--brand) 35%, var(--line)); background:color-mix(in srgb, var(--brand) 5%, var(--panel)); margin-bottom:6px }
.e3d-props-tit{ display:flex; align-items:center; gap:8px; margin-bottom:10px; color:var(--brand) }
.e3d-props-tit b{ color:var(--ink); font-size:14px }
.e3d-multi{ position:absolute; left:0; right:0; margin:0 auto; width:max-content; bottom:64px; z-index:6; padding:7px 8px 7px 12px; display:flex; gap:5px; align-items:center;
  font:600 12.5px var(--sans); max-width:calc(100% - 24px); flex-wrap:wrap; justify-content:center; animation:e3dsobe .2s var(--ease) }
@keyframes e3dsobe{ from{ opacity:0; transform:translateY(6px) } }
.e3d.com-multi .e3d-hud{ display:none }
.e3d-multi .btn{ height:32px; padding:0 11px; font-size:12px; border-radius:9px; display:inline-flex; align-items:center; gap:3px }
.e3d-multi .btn .u{ font-weight:500; color:inherit; opacity:.75; max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.e3d-multi .btn.so-ico{ width:32px; padding:0; justify-content:center }
.e3d-alinhar{ position:relative }
.e3d-alinhar-pop{ display:none; position:absolute; bottom:40px; left:50%; transform:translateX(-50%); padding:8px; grid-template-columns:repeat(3, auto); gap:4px; z-index:8 }
.e3d-alinhar-pop.on{ display:grid }
.e3d-alinhar-pop .btn{ white-space:nowrap }
.e3d-obj.multi{ background:color-mix(in srgb, #1f6feb 8%, transparent); border-color:color-mix(in srgb, #1f6feb 40%, transparent) }
.e3d-tag-furo{ font:700 9.5px var(--sans); text-transform:uppercase; letter-spacing:.05em; color:#fff; background:#e5484d; border-radius:6px; padding:2px 5px }
@media (max-width:900px){ .e3d-multi{ bottom:62px } .e3d-formas{ grid-template-columns:repeat(4, 1fr) } }
.ferr-modos{ margin-bottom:14px }
`;

export function injetarCSS() {
  if (document.getElementById('e3d-css')) return;
  const s = document.createElement('style');
  s.id = 'e3d-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}
