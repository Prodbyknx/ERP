// ABRIR NO BAMBU STUDIO (um clique).
// O Bambu Studio abre arquivo pelo link bambustudio://open?file=<https>&name=<x>.3mf
// (o mesmo do botão do MakerWorld; conferido em GUI_App.cpp e Plater.cpp:
// ele baixa o arquivo desse endereço e abre; o nome tem que terminar em .3mf;
// de site que não é o MakerWorld ele pergunta uma vez "abrir mesmo assim?").
// Ele NÃO consegue ler um arquivo que só existe no navegador: por isso o 3MF
// sobe pra uma pasta PARTICULAR do usuário no Supabase (bucket "estudio3d",
// um arquivo por usuário, sobrescrito a cada envio) e vai um link que vale
// 15 minutos.
// Segurança: usa só a chave pública do config.js + o passe da sessão já
// aberta no ERP (lido do navegador), sem renovar sessão nem mexer no cloud.js
// — não tem como derrubar o login do ERP. Sem nuvem (pacote de teste, sem
// login, ou bucket não criado): baixa o arquivo e explica.
import { baixar } from './util.js';

export const BUCKET = 'estudio3d';

// nome que vira arquivo no computador (sem barra, sem acento estranho)
export const nomeSeguro = n => (String(n || 'modelo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 _.-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.3mf$/i, '') || 'modelo').slice(0, 80);

// link que o Bambu entende: ele decodifica tudo, pega o que vem depois de
// "file=" e separa o nome no "&name="
export function linkBambu(urlArquivo, nome) {
  return 'bambustudio://open?file=' + encodeURIComponent(urlArquivo + '&name=' + nomeSeguro(nome) + '.3mf');
}

// sessão do ERP na nuvem (mesmo navegador): { cfg, token, uid } ou null
export function sessaoNuvem() {
  try {
    const cfg = window.ERP_CONFIG;
    if (!cfg || !cfg.url || !cfg.publicKey || !window.supabase || !window.supabase.createClient) return null;
    const ref = new URL(cfg.url).hostname.split('.')[0];
    const s = JSON.parse(localStorage.getItem('sb-' + ref + '-auth-token') || 'null');
    const token = s && (s.access_token || (s.currentSession && s.currentSession.access_token));
    const user = s && (s.user || (s.currentSession && s.currentSession.user));
    if (!token || !user || !user.id) return null;
    const exp = s.expires_at || (s.currentSession && s.currentSession.expires_at);
    if (exp && exp * 1000 < Date.now() + 20000) return { vencida: true };
    return { cfg, token, uid: user.id };
  } catch (e) { return null; }
}

function abrirProtocolo(url) {
  if (typeof window.__e3dAbrirProtocolo === 'function') { window.__e3dAbrirProtocolo(url); return; }
  const a = document.createElement('a');
  a.href = url; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
}

// bytes: 3MF pronto; nome: sem extensão.
// Devolve { modo: 'bambu' | 'baixado', link?, motivo?, abrirDeNovo? }
export async function abrirNoBambu(bytes, nome, t0 = Date.now()) {
  const s = sessaoNuvem();
  let motivo = s ? null : 'sem-nuvem';
  if (s && s.vencida) motivo = 'sessao';
  else if (s) {
    try {
      const cli = window.supabase.createClient(s.cfg.url, s.cfg.publicKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'e3d-bambu' },
        global: { headers: { Authorization: 'Bearer ' + s.token } }
      });
      const caminho = s.uid + '/bambu.3mf';
      const up = await cli.storage.from(BUCKET).upload(caminho, new Blob([bytes], { type: 'model/3mf' }), { upsert: true, contentType: 'model/3mf', cacheControl: '0' });
      if (up.error) throw up.error;
      const sg = await cli.storage.from(BUCKET).createSignedUrl(caminho, 900);
      if (sg.error || !sg.data || !sg.data.signedUrl) throw sg.error || new Error('sem link');
      const link = linkBambu(sg.data.signedUrl, nome);
      // o navegador só abre outro programa logo depois do clique: se o envio
      // demorou, quem chama mostra o botão "Abrir agora"
      const aTempo = Date.now() - t0 < 4000;
      if (aTempo) abrirProtocolo(link);
      return { modo: 'bambu', link, aTempo, abrirDeNovo: () => abrirProtocolo(link) };
    } catch (e) {
      const m = String((e && (e.message || e.error)) || e);
      motivo = /bucket|not found|404/i.test(m) ? 'sem-bucket' : /row-level|policy|403|Unauthorized/i.test(m) ? 'sem-permissao' : 'falha';
      console.warn('Abrir no Bambu: nuvem indisponível, baixando o arquivo', m);
    }
  }
  baixar(bytes, nomeSeguro(nome) + '.3mf', 'model/3mf');
  return { modo: 'baixado', motivo };
}

// texto curto pro usuário depois do clique
export function explicar(r) {
  if (r.modo === 'bambu') return r.aTempo
    ? 'Abrindo no Bambu Studio… Se ele perguntar se o arquivo é de site confiável, clique <b>Sim</b> (é o seu arquivo, na sua nuvem). Na primeira vez o navegador pergunta se pode abrir o Bambu Studio: marque "sempre permitir".'
    : 'Arquivo pronto na nuvem. Clique em <b>Abrir agora</b> pro navegador abrir o Bambu Studio.';
  const dica = ' Pra abrir sozinho nas próximas vezes: na barra de downloads do Chrome/Edge, clique na setinha do arquivo e marque <b>"Sempre abrir arquivos deste tipo"</b> — o .3mf abre direto no Bambu Studio.';
  if (r.motivo === 'sem-bucket') return 'O arquivo foi baixado. Pra abrir direto no Bambu falta criar a pasta "estudio3d" no Supabase (uma vez só: o administrador roda o arquivo supabase/estudio3d-bambu.sql no SQL Editor).' + dica;
  if (r.motivo === 'sem-permissao') return 'O arquivo foi baixado. A pasta "estudio3d" do Supabase existe, mas faltam as permissões (rode de novo supabase/estudio3d-bambu.sql).' + dica;
  if (r.motivo === 'sessao') return 'O arquivo foi baixado (sua sessão da nuvem estava renovando — tente de novo em alguns segundos pra abrir direto).' + dica;
  return 'O arquivo foi baixado.' + dica;
}
