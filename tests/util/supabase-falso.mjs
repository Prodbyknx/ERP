// SUPABASE FALSO para testar o cloud.js de verdade no navegador: HTTPS e
// WebSocket reais (o Chromium resolve o endereço *.supabase.co para cá com
// --host-resolver-rules), com o mesmo comportamento que importa do Supabase:
//  - Auth: login por senha, token JWT com validade, refresh com rotação,
//    refresh recusado (sessão revogada) ou fora do ar (503), /user, logout
//  - PostgREST: profiles, rpc/erp_changes e rpc/erp_commit_sync; chamada
//    ANÔNIMA à RPC = 401 "permission denied" (como sem GRANT para anon);
//    token vencido = 401 "JWT expired" (PGRST303)
//  - Realtime (Phoenix v1): join com postgres_changes, heartbeat, leave e
//    envio das mudanças para quem está inscrito
// Tudo que o navegador pede fica registrado para o teste conferir.
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const CHAVE_PUBLICA = 'sb_publishable_teste144';
const SEGREDO = crypto.randomBytes(32);
const b64 = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');

function certificado(host) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbfalso-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=' + host,
    '-addext', 'subjectAltName=DNS:' + host, '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
  const r = { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) };
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

// banco (opcional): em vez de imitar as funções, roda as de VERDADE num
// PostgreSQL local (tests/util/postgres.mjs -> postgrest()), como o usuário do
// token — é o jeito de testar o site contra o seguranca/protecao-servidor.sql.
export async function supabaseFalso({ host = 'teste144.supabase.co', ttl = 3600, usuarios, banco = null } = {}) {
  const st = {
    ttl, foraDoAr: false, revision: 0, ordem: 0,
    desvio: 0,                    // ms somados ao relógio do servidor (simula o tempo passando)
    recusarWS: false,             // Realtime fora do ar: recusa conexões novas
    exigirCaptcha: false,         // CAPTCHA ligado no Auth: login sem token é recusado
    tentativasWS: [],             // horário de cada tentativa de conexão WS
    usuarios: usuarios || [{ id: '00000000-0000-4000-8000-000000000001', email: 'dono@teste.com', senha: 'senha-certa', nome: 'Dono', login: 'dono@teste.com', perfil: 'ADMIN' }],
    refresh: new Map(),           // refresh_token -> { uid, usado, revogado }
    registros: new Map(),         // 'col|id' -> linha
    apagados: [],
    pedidos: [],                  // { metodo, caminho, status, quem }
    sockets: new Set(),           // conexões abertas
    conexoes: 0,                  // total já aberto
    joins: 0, leaves: 0
  };
  const log = (metodo, caminho, status, quem) => st.pedidos.push({ metodo, caminho, status, quem, t: Date.now() });

  const agoraMs = () => Date.now() + st.desvio;
  function jwt(uid) {
    const agora = Math.floor(agoraMs() / 1000);
    const corpo = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: uid, role: 'authenticated', aud: 'authenticated', iat: agora, exp: agora + st.ttl, session_id: 's' });
    return corpo + '.' + crypto.createHmac('sha256', SEGREDO).update(corpo).digest('base64url');
  }
  // 'anon' | 'vencido' | 'invalido' | usuário
  function quem(auth) {
    const t = String(auth || '').replace(/^Bearer\s+/i, '');
    if (!t || t === CHAVE_PUBLICA) return 'anon';
    const p = t.split('.');
    if (p.length !== 3 || crypto.createHmac('sha256', SEGREDO).update(p[0] + '.' + p[1]).digest('base64url') !== p[2]) return 'invalido';
    const c = JSON.parse(Buffer.from(p[1], 'base64url'));
    if (c.exp * 1000 <= agoraMs()) return 'vencido';
    return st.usuarios.find(u => u.id === c.sub) || 'invalido';
  }
  function sessao(u) {
    const rt = crypto.randomBytes(12).toString('hex');
    st.refresh.set(rt, { uid: u.id, usado: false, revogado: false });
    return { access_token: jwt(u.id), token_type: 'bearer', expires_in: st.ttl, expires_at: Math.floor(agoraMs() / 1000) + st.ttl, refresh_token: rt,
      user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
  }
  const linhaPublica = r => ({ collection: r.collection, id: r.id, data: r.data, sync_revision: r.sync_revision, insertion_order: r.insertion_order });

  // -------- Realtime: WebSocket (RFC 6455) + Phoenix v1
  function enviarWS(sock, obj) {
    if (sock.destroyed) return;
    const dados = Buffer.from(JSON.stringify(obj));
    const cab = dados.length < 126 ? Buffer.from([0x81, dados.length]) : dados.length < 65536 ? Buffer.from([0x81, 126, dados.length >> 8, dados.length & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(dados.length), 2); return b; })();
    sock.write(Buffer.concat([cab, dados]));
  }
  function mudancaRealtime(tabela, linha, tipo = 'INSERT') {
    for (const s of st.sockets) for (const [topico, j] of s.topicos) {
      if (typeof quem('Bearer ' + j.token) !== 'object') continue;   // só quem está logado recebe (RLS)
      const b = j.ids[tabela];
      if (!b) continue;
      enviarWS(s.sock, { topic: topico, event: 'postgres_changes', ref: null, payload: { ids: [b], data: {
        schema: 'public', table: tabela, commit_timestamp: new Date().toISOString(), type: tipo, errors: null,
        columns: Object.keys(linha).map(name => ({ name, type: 'text' })),
        record: linha, ...(tipo === 'UPDATE' ? { old_record: { id: linha.id } } : {}) } } });
    }
  }
  function aoMensagemWS(s, m) {
    if (m.topic === 'phoenix' && m.event === 'heartbeat') return enviarWS(s.sock, { topic: 'phoenix', event: 'phx_reply', ref: m.ref, payload: { status: 'ok', response: {} } });
    if (m.event === 'phx_join') {
      st.joins++;
      const pc = (m.payload.config && m.payload.config.postgres_changes) || [];
      const ids = {}, resp = pc.map((f, i) => { const id = 100 + i; ids[f.table] = id; return { id, event: f.event, schema: f.schema, table: f.table, ...(f.filter ? { filter: f.filter } : {}) }; });
      s.topicos.set(m.topic, { ids, token: m.payload.access_token || '' });
      return enviarWS(s.sock, { topic: m.topic, event: 'phx_reply', ref: m.ref, join_ref: m.join_ref, payload: { status: 'ok', response: { postgres_changes: resp } } });
    }
    if (m.event === 'access_token') { const j = s.topicos.get(m.topic); if (j) j.token = m.payload.access_token || ''; return; }
    if (m.event === 'phx_leave') { st.leaves++; s.topicos.delete(m.topic); return enviarWS(s.sock, { topic: m.topic, event: 'phx_reply', ref: m.ref, join_ref: m.join_ref, payload: { status: 'ok', response: {} } }); }
  }
  function aceitarWS(req, sock) {
    const chave = req.headers['sec-websocket-key'];
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
      crypto.createHash('sha1').update(chave + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
    const s = { sock, topicos: new Map(), buf: Buffer.alloc(0) };
    st.sockets.add(s); st.conexoes++;
    const fim = () => st.sockets.delete(s);
    sock.on('close', fim); sock.on('error', fim);
    sock.on('data', d => {
      s.buf = Buffer.concat([s.buf, d]);
      for (;;) {
        if (s.buf.length < 2) return;
        const op = s.buf[0] & 15; let n = s.buf[1] & 127, p = 2;
        if (n === 126) { if (s.buf.length < 4) return; n = s.buf.readUInt16BE(2); p = 4; } else if (n === 127) { if (s.buf.length < 10) return; n = Number(s.buf.readBigUInt64BE(2)); p = 10; }
        if (s.buf.length < p + 4 + n) return;
        const masc = s.buf.subarray(p, p + 4), dados = Buffer.from(s.buf.subarray(p + 4, p + 4 + n));
        for (let i = 0; i < dados.length; i++) dados[i] ^= masc[i & 3];
        s.buf = s.buf.subarray(p + 4 + n);
        if (op === 8) { try { sock.write(Buffer.from([0x88, 0])); } catch { /* ok */ } sock.end(); fim(); return; }
        if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8A, dados.length]), dados])); continue; }
        if (op === 1) { try { aoMensagemWS(s, JSON.parse(dados.toString())); } catch { /* ignora lixo */ } }
      }
    });
  }

  // -------- HTTP
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, prefer, accept, accept-profile, content-profile, x-supabase-api-version, range',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'content-range' };
  const srv = https.createServer(certificado(host), (req, res) => {
    let corpo = '';
    req.on('data', d => { corpo += d; });
    req.on('end', () => {
      const u = new URL(req.url, 'https://' + host), p = u.pathname;
      const r = (status, obj, extra = {}) => { res.writeHead(status, { ...CORS, 'Content-Type': 'application/json', ...extra }); res.end(obj === undefined ? '' : JSON.stringify(obj)); if (req.method !== 'OPTIONS') log(req.method, p + (u.searchParams.get('grant_type') ? '?' + u.searchParams.get('grant_type') : ''), status, q); };
      if (req.method === 'OPTIONS') return r(204);
      let q = quem(req.headers.authorization); q = typeof q === 'object' ? 'usuario' : q;
      const eu = quem(req.headers.authorization);
      const json = (() => { try { return JSON.parse(corpo || '{}'); } catch { return {}; } })();
      // Auth
      if (p === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
        st.ultimoLogin = json;
        if (st.exigirCaptcha && !(json.gotrue_meta_security && json.gotrue_meta_security.captcha_token)) return r(400, { code: 'captcha_failed', error_code: 'captcha_failed', msg: 'captcha verification process failed' });
        const us = st.usuarios.find(x => x.email === json.email && x.senha === json.password);
        return us ? r(200, sessao(us)) : r(400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      if (p === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') {
        if (st.foraDoAr) return r(503, { message: 'Service Unavailable' });
        const t = st.refresh.get(json.refresh_token);
        if (!t || t.revogado || t.usado) return r(400, { code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
        t.usado = true;
        return r(200, sessao(st.usuarios.find(x => x.id === t.uid)));
      }
      if (p === '/auth/v1/user') return typeof eu === 'object' ? r(200, sessao(eu).user) : r(403, { code: 'bad_jwt', msg: 'invalid JWT' });
      if (p === '/auth/v1/logout') { for (const t of st.refresh.values()) t.revogado = true; return r(204); }
      // PostgREST
      if (p.startsWith('/rest/v1/') && banco && (q === 'usuario' || q === 'anon')) {
        // o PostgREST de verdade: RPC e profiles viram SQL como o usuário do token
        const uid = q === 'usuario' ? eu.id : null;
        if (p.startsWith('/rest/v1/rpc/')) (st.rpcs = st.rpcs || []).push({ nome: p.slice(13), uid, restore: json.restore, mudancas: Array.isArray(json.changes) ? json.changes.map(c => c.collection + '/' + c.id) : undefined });
        const x = p.startsWith('/rest/v1/rpc/') ? banco.rpc(p.slice('/rest/v1/rpc/'.length), json, uid)
          : p === '/rest/v1/profiles' ? banco.perfis(u.searchParams.get('id')?.replace(/^eq\./, '') || null, uid)
          : { status: 404, body: { code: 'PGRST205', message: 'not found' } };
        if (x.status === 200 && p === '/rest/v1/profiles' && /vnd\.pgrst\.object/.test(req.headers.accept || '')) {
          return x.body.length === 1 ? r(200, x.body[0]) : r(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
        }
        r(x.status, x.body);
        avisarBanco();
        return;
      }
      if (p.startsWith('/rest/v1/')) {
        if (q === 'vencido') return r(401, { code: 'PGRST303', details: null, hint: null, message: 'JWT expired' });
        if (q === 'invalido') return r(401, { code: 'PGRST301', details: null, hint: null, message: 'JWSError JWSInvalidSignature' });
        if (p === '/rest/v1/profiles') {
          const lista = q === 'anon' ? [] : st.usuarios.filter(x => !u.searchParams.get('id') || u.searchParams.get('id') === 'eq.' + x.id).map(x => ({ id: x.id, nome: x.nome, login: x.login, perfil: x.perfil }));
          if (/vnd\.pgrst\.object/.test(req.headers.accept || '')) return lista.length === 1 ? r(200, lista[0]) : r(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
          return r(200, lista);
        }
        if (p === '/rest/v1/rpc/erp_changes' || p === '/rest/v1/rpc/erp_commit_sync') {
          if (q === 'anon') return r(401, { code: '42501', details: null, hint: null, message: 'permission denied for function ' + p.split('/').pop() });
          if (p.endsWith('erp_changes')) {
            const desde = BigInt(json.since_revision || 0);
            return r(200, { rows: [...st.registros.values()].filter(x => BigInt(x.sync_revision) > desde).map(linhaPublica),
              deleted: st.apagados.filter(x => BigInt(x.sync_revision) > desde), cursor: String(st.revision), reset_required: false });
          }
          return r(200, aplicar(json.changes || []));
        }
        return r(404, { code: 'PGRST202', message: 'not found' });
      }
      r(404, { message: 'não existe' });
    });
  });
  srv.on('upgrade', (req, sock) => {
    if (!req.url.startsWith('/realtime/v1/websocket')) { sock.destroy(); return; }
    st.tentativasWS.push(Date.now());
    if (st.recusarWS) { log('WS', '/realtime/v1/websocket', 503, 'ws'); sock.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n'); return; }
    log('WS', '/realtime/v1/websocket', 101, 'ws');
    aceitarWS(req, sock);
  });
  // com banco: o gatilho do servidor sobe erp_sinal.versao; o tempo real manda o UPDATE
  let versaoSinal = banco ? banco.versaoSinal() : 0;
  function avisarBanco() {
    if (!banco) return;
    const v = banco.versaoSinal();
    if (v !== versaoSinal) { versaoSinal = v; mudancaRealtime('erp_sinal', { id: 1, versao: v, em: new Date().toISOString() }, 'UPDATE'); }
  }
  // grava mudanças (como erp_commit_sync) e avisa o tempo real
  function aplicar(changes) {
    const rows = [], deleted = [];
    for (const c of changes) {
      const k = c.collection + '|' + c.id;
      st.revision++;
      if (c.after == null) { st.registros.delete(k); const d = { collection: c.collection, id: String(c.id), sync_revision: st.revision }; st.apagados.push(d); deleted.push(d); mudancaRealtime('erp_deleted', d); }
      else {
        const velho = st.registros.get(k);
        const l = { collection: c.collection, id: String(c.id), data: c.after, sync_revision: st.revision, insertion_order: velho ? velho.insertion_order : ++st.ordem };
        st.registros.set(k, l); rows.push(linhaPublica(l)); mudancaRealtime('erp_records', linhaPublica(l));
      }
    }
    return { rows, deleted, cursor: String(st.revision) };
  }
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  return {
    host, porta: srv.address().port, url: 'https://' + host, estado: st, aplicar, avisarBanco,
    // o que o Chromium precisa pra achar este servidor pelo nome *.supabase.co
    // (e sem passar pelo proxy da máquina, se houver)
    argsChromium: () => ['--host-resolver-rules=MAP ' + host + ' 127.0.0.1:' + srv.address().port, '--no-proxy-server', '--ignore-certificate-errors'],
    revogarTudo() { for (const t of st.refresh.values()) t.revogado = true; },
    // derruba as conexões do tempo real abertas agora (queda do servidor)
    derrubarWS() { for (const s of st.sockets) s.sock.destroy(); },
    pedidosDe: (filtro, desde = 0) => st.pedidos.filter(x => x.t >= desde && (!filtro || filtro(x))),
    socketsAbertos: () => st.sockets.size,
    topicosAbertos: () => [...st.sockets].reduce((n, s) => n + s.topicos.size, 0),
    // tabelas que os canais abertos pediram no tempo real
    tabelasInscritas: () => [...st.sockets].flatMap(s => [...s.topicos.values()].flatMap(j => Object.keys(j.ids))).sort(),
    fechar() { for (const s of st.sockets) s.sock.destroy(); return new Promise(ok => srv.close(ok)); }
  };
}
