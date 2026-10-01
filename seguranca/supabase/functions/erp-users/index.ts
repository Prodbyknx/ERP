// Edge Function erp-users — liga a lógica (logica.js) ao Supabase.
// Publicar: Supabase > Edge Functions > erp-users > (editar) > colar este
// arquivo e o logica.js > Deploy. "Verify JWT" LIGADO.
// Variáveis de ambiente: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm do
// Supabase (não copie a chave pra lugar nenhum). Opcional: SITE_ORIGINS
// (endereços do ERP separados por vírgula).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { tratar, cabecalhosCors, Recusa } from './logica.js';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const permitidas = (Deno.env.get('SITE_ORIGINS') || 'https://erp.144labstore.com.br').split(',').map(s => s.trim()).filter(Boolean);
const falhou = (e: { message?: string } | null) => { if (e) throw new Error(e.message || 'erro no banco'); };

const db = {
  async usuarioDoToken(token: string) { const { data, error } = await admin.auth.getUser(token); return error ? null : data.user; },
  async perfil(id: string) { const { data, error } = await admin.from('profiles').select('id,nome,login,perfil').eq('id', id).maybeSingle(); falhou(error); return data; },
  async contarAdmins() { const { count, error } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('perfil', 'ADMIN'); falhou(error); return count ?? 0; },
  async criarConta(email: string, password: string, nome: string) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nome } });
    if (error) throw new Recusa(400, /already/i.test(error.message) ? 'Já existe uma conta com este e-mail' : error.message);
    return data.user.id;
  },
  async apagarConta(id: string) { const { error } = await admin.auth.admin.deleteUser(id); falhou(error); },
  async trocarSenha(id: string, password: string) { const { error } = await admin.auth.admin.updateUserById(id, { password }); if (error) throw new Recusa(400, error.message); },
  async gravarPerfil(p: Record<string, string>) { const { error } = await admin.from('profiles').upsert(p); falhou(error); },
  async mudarPerfil(id: string, m: Record<string, string>) { const { error } = await admin.from('profiles').update(m).eq('id', id); falhou(error); },
  async apagarPerfil(id: string) { const { error } = await admin.from('profiles').delete().eq('id', id); falhou(error); }
};

Deno.serve(async req => {
  const cors = cabecalhosCors(req.headers.get('Origin') || '', permitidas);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const corpo = await req.json().catch(() => null);
    return json(200, await tratar(token, corpo, db));
  } catch (e) {
    if (e instanceof Recusa) return json(e.status, { error: e.message });
    console.error('erp-users:', e);
    return json(500, { error: 'Erro no servidor' });   // sem detalhe interno pra quem chamou
  }
});
