// Laboratório Fotos -> 3D (só no pacote de TESTE; não é a interface final e não
// mexe no Estúdio). Usa o mesmo motor, os mesmos provedores e o mesmo pipeline
// que a interface final vai usar; o 3MF que sai abre no Estúdio pelo "Abrir".
import { Motor } from '../motor/cliente.js';
import { VISTAS, prepararVistas } from '../core/ia/reconstrucao.js';
import { silhuetasAlinhadas } from '../core/ia/avaliacao.js';
import { provedorSilhuetas, provedorServidor } from '../core/ia/provedores.js';
import { gerarDeFotos } from '../core/ia/pipeline.js';

const motor = new Motor();
const rodar = (op, args) => motor.rodar(op, args);
const fotos = {};
let ultimo = null;
const $ = s => document.querySelector(s);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function lerFoto(arq) {
  const bmp = await createImageBitmap(arq);
  const k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, w, h);
  return { w, h, rgba: new Uint8Array(g.getImageData(0, 0, w, h).data.buffer), png: new Uint8Array(await arq.arrayBuffer()), url: c.toDataURL('image/png') };
}

function montarVistas() {
  $('#vistas').innerHTML = Object.entries(VISTAS).map(([id, v]) =>
    '<label class="vista" data-v="' + id + '"><span>' + esc(v.nome) + '</span><div class="img">+ foto</div><input type="file" accept="image/*" hidden></label>').join('');
  for (const el of document.querySelectorAll('.vista')) {
    el.querySelector('input').addEventListener('change', async ev => {
      const arq = ev.target.files[0]; if (!arq) return;
      try {
        fotos[el.dataset.v] = await lerFoto(arq);
        el.querySelector('.img').innerHTML = '<img alt="" src="' + fotos[el.dataset.v].url + '">';
        el.classList.add('ok');
      } catch (e) { msg('Não consegui ler ' + arq.name + ': ' + e.message, true); }
    });
  }
}

function msg(t, erro) { const m = $('#msg'); m.textContent = t; m.className = erro ? 'erro' : ''; }

function provedorEscolhido() {
  if ($('#prov').value === 'servidor') return provedorServidor({ url: $('#url').value.trim(), token: $('#token').value.trim(), modelo: $('#modelo').value.trim() });
  return provedorSilhuetas(rodar);
}

async function gerar() {
  const entradas = Object.entries(fotos).map(([vista, f]) => ({ vista, rgba: f.rgba, w: f.w, h: f.h, png: f.png }));
  const alturaMM = +$('#altura').value;
  if (!(alturaMM > 0)) return msg('Informe a altura real do objeto em mm.', true);
  const prov = provedorEscolhido();
  $('#gerar').disabled = true; $('#saida').hidden = true;
  const t0 = performance.now();
  try {
    if (prov.onde === 'servidor') { const d = await prov.disponivel(); if (!d.ok) throw new Error(d.motivo); }
    msg('Gerando…');
    const r = await gerarDeFotos(prov, entradas, { alturaMM, nome: 'Modelo das fotos' }, rodar, { progresso: (f, t) => msg(t + '…') });
    ultimo = r;
    mostrar(r, entradas, alturaMM);
    msg('Pronto em ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s.');
  } catch (e) { msg(e.message, true); } finally { $('#gerar').disabled = false; }
}

function mostrar(r, entradas, alturaMM) {
  const a = r.relatorio.avaliacao, malha = r.objeto.partes[0].malha;
  const pct = x => (x * 100).toFixed(1) + '%';
  $('#numeros').innerHTML = [
    ['Imprimível (fechado, sem auto-interseção)', a.imprimivel ? 'sim' : 'NÃO'],
    ['Fidelidade média / pior vista', pct(a.fidelidadeMedia) + ' / ' + pct(a.fidelidadeMinima)],
    ['Medidas (mm)', a.medidasMM.join(' × ')], ['Volume', a.volumeCm3.toFixed(1) + ' cm³'],
    ['Triângulos', a.triangulos.toLocaleString('pt-BR')], ['Giro aplicado', r.relatorio.giro + '°'],
    ['Consertos automáticos', (r.relatorio.reparo || []).length ? r.relatorio.reparo.map(p => p.texto || p.nome || p).join('; ') : 'nenhum'],
    ['Gerador', r.relatorio.provedor], ['Tempo', (r.relatorio.tempos.totalMs / 1000).toFixed(1) + ' s']
  ].map(([k, v]) => '<tr><th>' + esc(k) + '</th><td>' + esc(v) + '</td></tr>').join('') +
    (r.relatorio.avisos || []).map(t => '<tr><th>Aviso</th><td>' + esc(t) + '</td></tr>').join('');
  // silhueta da foto × do modelo, por vista: verde = bate, vermelho = faltou no modelo, azul = sobrou
  const prep = prepararVistas(entradas, alturaMM);
  $('#comparar').innerHTML = '';
  for (const v of prep.vistas) {
    const s = silhuetasAlinhadas(malha, v), c = document.createElement('canvas');
    c.width = s.w; c.height = s.h;
    const g = c.getContext('2d'), img = g.createImageData(s.w, s.h), d = img.data;
    for (let i = 0; i < s.modelo.length; i++) {
      const m = s.modelo[i], f = s.foto[i];
      const cor = m && f ? [46, 160, 67, 255] : f ? [218, 54, 51, 255] : m ? [56, 132, 255, 255] : [0, 0, 0, 0];
      d.set(cor, i * 4);
    }
    g.putImageData(img, 0, 0);
    const fig = document.createElement('figure');
    fig.appendChild(c);
    fig.insertAdjacentHTML('beforeend', '<figcaption>' + esc(VISTAS[v.vista].nome) + ' — ' + pct(a.fidelidade[v.vista] || 0) + '</figcaption>');
    $('#comparar').appendChild(fig);
  }
  $('#saida').hidden = false;
}

function baixar(bytes, nome) {
  const u = URL.createObjectURL(new Blob([bytes], { type: 'model/3mf' }));
  const l = document.createElement('a'); l.href = u; l.download = nome; l.click();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
}

async function baixar3MF(porCor) {
  if (!ultimo) return;
  try {
    let partes = ultimo.objeto.partes;
    if (porCor) {
      msg('Separando por cor (camadas de 0,8 mm)…');
      const s = await rodar('separarPorCor', { parte: partes[0], opc: { espessura: 0.8 } });
      partes = s.pecas;
      if (s.avisos.length) msg(s.avisos.join(' '));
    }
    const x = await rodar('exportar3MF', { cena: { objetos: [{ ...ultimo.objeto, partes }] }, opc: {} });
    baixar(x.bytes, porCor ? 'modelo-das-fotos-por-cor.3mf' : 'modelo-das-fotos.3mf');
    if (porCor) msg('3MF separado por cor baixado: ' + partes.length + ' peças.');
  } catch (e) { msg(e.message, true); }
}

function iniciar() {
  montarVistas();
  $('#gerar').addEventListener('click', gerar);
  $('#b3mf').addEventListener('click', () => baixar3MF(false));
  $('#bcor').addEventListener('click', () => baixar3MF(true));
  $('#prov').addEventListener('change', () => { $('#srv').hidden = $('#prov').value !== 'servidor'; });
  $('#testar').addEventListener('click', async () => { const d = await provedorEscolhido().disponivel(); msg(d.ok ? 'Servidor OK' + (d.info && d.info.gpu ? ' (GPU ' + d.info.vramGB + ' GB)' : ' (sem GPU)') : d.motivo, !d.ok); });
  motor.iniciar();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
