// FUNÇÃO erp-users (criar, editar, trocar senha e apagar usuários do ERP).
// Roda NO SERVIDOR do Supabase (Edge Function). A chave de serviço vem da
// variável de ambiente que o próprio Supabase injeta — nunca vai pro site.
// Regras: só quem está logado E é ADMIN (conferido no banco, não na tela);
// tudo validado; ninguém apaga/rebaixa a si mesmo; o último ADMIN nunca sai.
// Este arquivo é só a lógica (testada em tests/erp-users.test.mjs); o
// index.ts liga ela ao Supabase.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERFIS = ['ADMIN', 'VENDEDOR'];

export class Recusa extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const nome_ = v => { const n = String(v ?? '').trim(); if (!n || n.length > 120) throw new Recusa(400, 'Informe o nome (até 120 letras)'); return n; };
const perfil_ = v => { if (!PERFIS.includes(v)) throw new Recusa(400, 'Perfil inválido'); return v; };
const senha_ = v => { if (typeof v !== 'string' || v.length < 8 || v.length > 72) throw new Recusa(400, 'A senha precisa ter de 8 a 72 caracteres'); return v; };
const id_ = v => { if (typeof v !== 'string' || !UUID.test(v)) throw new Recusa(400, 'Usuário inválido'); return v; };

// db: { usuarioDoToken(token), perfil(id), contarAdmins(), criarConta(email, senha, nome),
//       apagarConta(id), trocarSenha(id, senha), gravarPerfil({id,nome,login,perfil}),
//       mudarPerfil(id, {nome, perfil}), apagarPerfil(id) }
export async function tratar(token, corpo, db) {
  if (!token) throw new Recusa(401, 'Entre com sua conta');
  const quem = await db.usuarioDoToken(token);
  if (!quem) throw new Recusa(401, 'Sessão inválida. Entre novamente.');
  const eu = await db.perfil(quem.id);
  if (!eu || eu.perfil !== 'ADMIN') throw new Recusa(403, 'Requer ADMIN');
  const b = corpo && typeof corpo === 'object' ? corpo : {};
  switch (b.action) {
    case 'create': {
      const login = String(b.login ?? '').trim().toLowerCase();
      if (!EMAIL.test(login) || login.length > 254) throw new Recusa(400, 'Informe um e-mail válido');
      const nome = nome_(b.nome), senha = senha_(b.senha), perfil = perfil_(b.perfil);
      const id = await db.criarConta(login, senha, nome);
      try { await db.gravarPerfil({ id, nome, login, perfil }); }
      catch (e) { await db.apagarConta(id).catch(() => {}); throw e; }   // não deixa conta sem perfil
      return { id };
    }
    case 'update': {
      const id = id_(b.id), nome = nome_(b.nome), perfil = perfil_(b.perfil);
      const alvo = await db.perfil(id);
      if (!alvo) throw new Recusa(404, 'Usuário não encontrado');
      if (id === quem.id && perfil !== 'ADMIN') throw new Recusa(400, 'Você não pode tirar o seu próprio acesso de ADMIN');
      if (alvo.perfil === 'ADMIN' && perfil !== 'ADMIN' && await db.contarAdmins() <= 1) throw new Recusa(400, 'Não dá pra tirar o último ADMIN');
      await db.mudarPerfil(id, { nome, perfil });
      return { id };
    }
    case 'password': {
      const id = id_(b.id), senha = senha_(b.senha);
      if (!(await db.perfil(id))) throw new Recusa(404, 'Usuário não encontrado');
      await db.trocarSenha(id, senha);
      return { id };
    }
    case 'delete': {
      const id = id_(b.id);
      if (id === quem.id) throw new Recusa(400, 'Você não pode apagar a sua própria conta');
      const alvo = await db.perfil(id);
      if (!alvo) throw new Recusa(404, 'Usuário não encontrado');
      if (alvo.perfil === 'ADMIN' && await db.contarAdmins() <= 1) throw new Recusa(400, 'Não dá pra apagar o último ADMIN');
      await db.apagarPerfil(id);
      await db.apagarConta(id);
      return { id };
    }
    default: throw new Recusa(400, 'Ação desconhecida');
  }
}

// CORS: só o endereço do ERP (e o que estiver na variável SITE_ORIGINS)
export function cabecalhosCors(origem, permitidas) {
  const ok = permitidas.includes(origem);
  return {
    'Access-Control-Allow-Origin': ok ? origem : permitidas[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}
