// CSS do Estúdio 3D. Usa as variáveis do ERP (--brand, --line, --panel...).
export const CSS = `
.e3d{ display:flex; flex-direction:column; gap:10px; }
.e3d *{ box-sizing:border-box }
.e3d-barra{ display:flex; flex-wrap:wrap; align-items:center; gap:6px; background:var(--panel); border:1px solid var(--line);
  border-radius:var(--radius); padding:8px 10px; box-shadow:var(--shadow-sm) }
.e3d-barra .sep{ width:1px; align-self:stretch; background:var(--line); margin:0 4px }
.e3d-barra button.btn{ padding:6px 10px; font-size:12.5px }
.e3d-barra button.btn.ativo{ background:var(--brand-soft); border-color:var(--brand); color:var(--brand) }
.e3d-barra select{ height:32px; font-size:12.5px; padding:0 8px; width:auto }
.e3d-barra .grow{ flex:1 }
.e3d-motor{ font:500 11.5px var(--sans); color:var(--ink-dim); display:flex; align-items:center; gap:6px }
.e3d-motor i{ width:8px; height:8px; border-radius:50%; background:#d1d5db; display:inline-block }
.e3d-motor.ok i{ background:#16a34a } .e3d-motor.ocupado i{ background:#f59e0b; animation:e3dpulsa 1s infinite }
@keyframes e3dpulsa{ 50%{ opacity:.35 } }
.e3d-corpo{ display:grid; grid-template-columns:230px minmax(0,1fr) 340px; gap:10px; align-items:stretch; height:min(78vh, 880px); min-height:520px }
.e3d-cena, .e3d-painel{ background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); overflow:auto; box-shadow:var(--shadow-sm) }
.e3d-cena{ padding:10px }
.e3d-painel{ padding:4px 12px 12px }
.e3d-palco{ position:relative; border:1px solid var(--line); border-radius:var(--radius); overflow:hidden; background:#eceef1; min-height:360px }
.e3d-canvas{ display:block; width:100%; height:100%; outline:none; touch-action:none }
.e3d-vazio{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;
  color:var(--ink-soft); font:500 13px var(--sans); pointer-events:none; text-align:center; padding:20px }
.e3d-vazio b{ font-size:15px; color:var(--ink) }
.e3d-palco.sobre{ outline:3px dashed var(--brand); outline-offset:-8px }
.e3d-hud{ position:absolute; left:10px; bottom:10px; font:500 11.5px var(--mono); color:var(--ink-soft);
  background:rgba(255,255,255,.86); border:1px solid var(--line); border-radius:8px; padding:5px 9px; pointer-events:none }
.e3d-dica{ position:absolute; right:10px; bottom:10px; font:500 11px var(--sans); color:var(--ink-dim); pointer-events:none;
  background:rgba(255,255,255,.7); border-radius:6px; padding:3px 7px }
.e3d-previa{ position:absolute; left:50%; top:10px; transform:translateX(-50%); background:#fff; border:1px solid var(--line);
  border-radius:10px; box-shadow:var(--shadow-md); padding:9px 12px; display:flex; gap:10px; align-items:center; font:500 12.5px var(--sans); z-index:3; max-width:94%; flex-wrap:wrap }
.e3d-previa .leg{ display:flex; gap:10px; color:var(--ink-soft); font-size:12px; flex-wrap:wrap }
.e3d-previa .leg span::before{ content:''; display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:5px; vertical-align:-1px; background:var(--c) }
.e3d-ocupado{ position:absolute; right:10px; top:10px; background:#fff; border:1px solid var(--line); border-radius:8px; padding:6px 10px;
  font:600 12px var(--sans); color:var(--ink-soft); display:none; z-index:4 }
.e3d-ocupado.on{ display:block }
.e3d-titulo{ font:700 11px/1.2 var(--sans); letter-spacing:.06em; text-transform:uppercase; color:var(--ink-dim); margin:4px 0 8px }
.e3d-obj{ border:1px solid var(--line); border-radius:9px; margin-bottom:7px; background:var(--panel-2) }
.e3d-obj.sel{ border-color:var(--brand); box-shadow:0 0 0 2px rgba(229,76,0,.12) }
.e3d-obj-cab{ display:flex; align-items:center; gap:6px; padding:7px 8px; cursor:pointer; font:600 12.5px var(--sans) }
.e3d-obj-cab .nome{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.e3d-obj-cab .med{ font:500 10.5px var(--mono); color:var(--ink-dim) }
.e3d-ico{ border:0; background:none; cursor:pointer; color:var(--ink-dim); padding:2px 4px; font-size:13px; line-height:1; border-radius:5px }
.e3d-ico:hover{ color:var(--ink); background:var(--line-soft) }
.e3d-parte{ display:flex; align-items:center; gap:7px; padding:5px 8px 5px 22px; font-size:12px; cursor:pointer; color:var(--ink-soft) }
.e3d-parte.sel{ color:var(--ink); font-weight:600; background:#fff }
.e3d-parte .nome{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.e3d-bola{ width:14px; height:14px; border-radius:50%; border:1px solid rgba(23,20,15,.25); flex:0 0 auto }
.e3d-painel details{ border-bottom:1px solid var(--line-soft); padding:6px 0 }
.e3d-painel details > summary{ cursor:pointer; list-style:none; display:flex; align-items:center; gap:8px; padding:8px 2px;
  font:700 13px var(--sans); color:var(--ink) }
.e3d-painel details > summary::-webkit-details-marker{ display:none }
.e3d-painel details > summary::after{ content:'+'; margin-left:auto; color:var(--ink-dim); font-weight:500; font-size:16px }
.e3d-painel details[open] > summary::after{ content:'−' }
.e3d-painel details > summary .n{ width:20px; height:20px; border-radius:6px; background:var(--brand-soft); color:var(--brand);
  font:700 11px var(--sans); display:inline-flex; align-items:center; justify-content:center }
.e3d-sec{ padding:2px 2px 8px }
.e3d-sec p.u, .e3d-sec .u{ font-size:12px; color:var(--ink-dim); line-height:1.45 }
.e3d-sec .field{ margin-bottom:10px }
.e3d-sec .field label{ font-size:12px; margin-bottom:4px }
.e3d-sec input[type=number], .e3d-sec input[type=text], .e3d-sec select, .e3d-sec textarea{ height:34px; font-size:13px; padding:0 9px }
.e3d-sec textarea{ height:auto; min-height:52px; padding:7px 9px; width:100%; border:1px solid var(--line); border-radius:8px; font:500 14px var(--sans); resize:vertical }
.e3d-l3{ display:grid; grid-template-columns:repeat(3,1fr); gap:6px }
.e3d-l2{ display:grid; grid-template-columns:repeat(2,1fr); gap:6px }
.e3d-l3 label, .e3d-l2 label{ font:600 11px var(--sans); color:var(--ink-dim); display:block; margin-bottom:3px }
.e3d-botoes{ display:flex; flex-wrap:wrap; gap:6px; margin-top:8px }
.e3d-botoes .btn{ padding:6px 10px; font-size:12.5px }
.e3d-botoes .btn.largo{ flex:1 1 100% }
.e3d-sec .seg{ margin-bottom:8px; flex-wrap:wrap }
.e3d-sec .seg button{ padding:6px 10px; font-size:12px }
.e3d-diag{ display:grid; grid-template-columns:1fr auto; gap:3px 10px; font-size:12px; margin:6px 0 }
.e3d-diag span{ color:var(--ink-soft) }
.e3d-diag b{ font-family:var(--mono); font-variant-numeric:tabular-nums; text-align:right }
.e3d-diag .bom{ color:var(--green) } .e3d-diag .ruim{ color:var(--red) } .e3d-diag .atencao{ color:var(--warn) }
.e3d-diag .grupo{ grid-column:1/-1; font:700 11px var(--sans); text-transform:uppercase; letter-spacing:.05em; color:var(--ink-dim); margin-top:6px }
.e3d-nota{ background:var(--panel-2); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:12px; color:var(--ink-soft); margin-top:8px; line-height:1.45 }
.e3d-nota.aviso{ background:var(--warn-soft); border-color:#fde68a; color:var(--warn) }
.e3d-nota.erro{ background:var(--red-soft); border-color:#fecaca; color:var(--red) }
.e3d-nota.ok{ background:var(--green-soft); border-color:#bbf7d0; color:var(--green) }
.e3d-swatches{ display:flex; flex-wrap:wrap; gap:6px; margin-top:6px }
.e3d-swatches button{ width:26px; height:26px; border-radius:50%; border:1px solid rgba(23,20,15,.2); cursor:pointer; padding:0 }
.e3d-swatches button:hover{ transform:scale(1.12) }
.e3d-partes-lista{ display:flex; flex-direction:column; gap:4px; margin-top:6px; max-height:200px; overflow:auto }
.e3d-partes-lista div{ display:flex; align-items:center; gap:6px; font-size:12px; padding:3px 5px; border-radius:6px; cursor:pointer }
.e3d-partes-lista div:hover{ background:var(--line-soft) }
.e3d-partes-lista input{ height:24px; font-size:12px; padding:0 6px; flex:1; min-width:0 }
.e3d-slider{ display:flex; align-items:center; gap:8px }
.e3d-slider input[type=range]{ flex:1; accent-color:var(--brand) }
.e3d-slider input[type=number]{ width:84px }
.e3d-cores-hex{ font:500 11px var(--mono); color:var(--ink-dim) }
@media (max-width:1180px){ .e3d-corpo{ grid-template-columns:200px minmax(0,1fr); height:auto } .e3d-palco{ height:62vh }
  .e3d-painel{ grid-column:1/-1; max-height:none } .e3d-cena{ max-height:62vh } }
@media (max-width:760px){ .e3d-corpo{ grid-template-columns:1fr } .e3d-cena{ max-height:220px } .e3d-palco{ height:58vh } }
.ferr-modos{ margin-bottom:14px }
`;

export function injetarCSS() {
  if (document.getElementById('e3d-css')) return;
  const s = document.createElement('style');
  s.id = 'e3d-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}
