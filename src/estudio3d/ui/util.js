// Utilidades de interface (DOM, números em pt-BR, downloads, avisos)

export function el(tag, attrs, ...filhos) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) e.appendChild(typeof f === 'string' || typeof f === 'number' ? document.createTextNode(String(f)) : f);
  return e;
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmt(v, casas = 1) {
  if (v == null || !isFinite(v)) return '—';
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function fmtInt(v) { return v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('pt-BR'); }

// aceita "12,5", "12.5", "1.234,5"
export function lerNumero(v, padrao = 0) {
  let s = String(v == null ? '' : v).trim().replace(/\s/g, '');
  if (!s) return padrao;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : padrao;
}

export function baixar(bytes, nome, tipo) {
  const blob = new Blob([bytes], { type: tipo || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}

export function avisar(msg, tipo = 'ok') {
  if (typeof window.toast === 'function') { try { window.toast(msg, tipo); return; } catch (e) { /* segue */ } }
  console.log('[Estúdio 3D]', msg);
}

export function lerArquivo(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result));
    r.onerror = () => reject(r.error || new Error('Não consegui ler o arquivo.'));
    r.readAsArrayBuffer(file);
  });
}

export function nomeArquivo(s, padrao = 'modelo') {
  const n = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40);
  return n || padrao;
}

export function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
