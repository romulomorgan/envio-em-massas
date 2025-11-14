// server.mjs
// Worker de processamento de campanhas (NocoDB + Evolution/WA) — compatível com o frontend IAdmin.
// Node 18+ (fetch nativo). ES Module.

const NOCO_URL   = process.env.NOCO_URL   || 'https://noco.iadmin.ai';
const NOCO_TOKEN = process.env.NOCO_TOKEN || 'nAJkoiL0CHMZRasa8wKp812aIs32tGzIyM0NdjAs';

// aceita tanto TABLE_SEND_* quanto NOCO_TABLE_* (compat)
const TABLE_SEND_QUEUE_ID = process.env.TABLE_SEND_QUEUE_ID || process.env.NOCO_TABLE_QUEUE_ID || 'm2jlcomq5xbl9ow';
const TABLE_SEND_LOGS_ID  = process.env.TABLE_SEND_LOGS_ID  || process.env.NOCO_TABLE_LOGS_ID  || 'm94sc6d7vih3589';

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const CONCURRENCY      = Math.max(1, Number(process.env.CONCURRENCY || 1));
const DRY_RUN          = /^true$/i.test(process.env.DRY_RUN || 'false');
const LOG_LEVEL        = process.env.LOG_LEVEL || 'info'; // 'debug'|'info'|'warn'|'error'

/* ======================= Utils ======================= */
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const clamp = (n,min,max)=> Math.min(max, Math.max(min, n));
const nowIso = ()=> new Date().toISOString().replace(/\.\d{3}Z$/,'Z');

function log(level, ...args){
  const order = {debug:0, info:1, warn:2, error:3};
  if(order[level] >= order[LOG_LEVEL]) console[level==='debug'?'log':level](
    `[${new Date().toISOString()}] [${level.toUpperCase()}]`,
    ...args
  );
}

function stripDigits(v){ return String(v||'').replace(/[^\d]/g,''); }
function ensureE164(num, cc='55'){
  const d=stripDigits(num);
  if(!d) return '';
  if(String(num).startsWith('+')) return num;
  if(d.startsWith('00')) return '+'+d.slice(2);
  if(d.length<=11) return '+'+cc+d;
  return d.startsWith(cc) ? '+'+d : '+'+d;
}
// Evolution prefere número sem "+", então normalizamos para dígitos puros
function asEvolutionNumber(numE164){ return stripDigits(numE164); }

function jitter(base=0, variance=0){
  const v = Math.max(0, Number(variance)||0);
  const b = Math.max(0, Number(base)||0);
  if(!v) return b;
  return clamp(Math.round(b + (Math.random()*2-1)*v), 0, 3600*24);
}

async function fetchJSON(url, opts={}){
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers||{}), 'Content-Type': 'application/json' }});
  const text = await res.text();
  let data = null;
  try{ data = text ? JSON.parse(text) : null; }catch{ data = text; }
  return { ok: res.ok, status: res.status, data };
}

// Trunca JSON para caber no limite de 100KB do NocoDB
function truncateJSON(obj, maxBytes = 95000) {
  const str = JSON.stringify(obj);
  if (str.length <= maxBytes) return str;
  
  // Se for muito grande, salva apenas o essencial
  const truncated = {
    ...obj,
    response: obj.response ? '[TRUNCADO - resposta muito grande]' : undefined,
    _original_size: str.length,
    _truncated: true
  };
  
  const newStr = JSON.stringify(truncated);
  if (newStr.length <= maxBytes) return newStr;
  
  // Se ainda for grande, remove mais campos
  return JSON.stringify({
    action: obj.action,
    status: obj.status,
    error: obj.error,
    _original_size: str.length,
    _truncated: true
  });
}

/* ===================== NocoDB helpers ===================== */
async function nocoGET(pathQuery){
  const url = `${NOCO_URL}${pathQuery}`;
  const r = await fetchJSON(url, { headers: { 'xc-token': NOCO_TOKEN }});
  if(!r.ok) throw new Error(`NocoDB GET ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
}
async function nocoPOST(path, body){
  const url = `${NOCO_URL}${path}`;
  const r = await fetchJSON(url, { method:'POST', body: JSON.stringify(body), headers: { 'xc-token': NOCO_TOKEN }});
  if(!r.ok) throw new Error(`NocoDB POST ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
}
async function nocoPATCH(path, body){
  const url = `${NOCO_URL}${path}`;
  const r = await fetchJSON(url, { method:'PATCH', body: JSON.stringify(body), headers: { 'xc-token': NOCO_TOKEN }});
  if(!r.ok) throw new Error(`NocoDB PATCH ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
}

/* ===================== Tabelas ===================== */
const queueBase = `/api/v2/tables/${TABLE_SEND_QUEUE_ID}/records`;
const logsBase  = `/api/v2/tables/${TABLE_SEND_LOGS_ID }/records`;

async function queueList(where, limit=20, sort='Id'){
  const q = `${queueBase}?where=${encodeURIComponent(where)}&limit=${limit}&sort=${encodeURIComponent(sort)}`;
  return await nocoGET(q);
}
async function queueGetOne(id){
  return await nocoGET(`${queueBase}/${id}`);
}
async function queuePatch(id, patch){
  return await nocoPATCH(`${queueBase}`, { Id:id, ...patch });
}
async function logsCreate(payload){
  return await nocoPOST(`${logsBase}`, payload);
}
async function logsListByQueueId(queueId){
  const where = encodeURIComponent(`(queue_id,eq,${queueId})`);
  const q = `${logsBase}?where=${where}&sort=-Id&limit=100000`;
  return await nocoGET(q);
}
async function logsListByRunId(runId){
  const where = encodeURIComponent(`(run_id,eq,${runId})`);
  const q = `${logsBase}?where=${where}&sort=-Id&limit=100000`;
  return await nocoGET(q);
}

/* ================= Evolution request + Failover ================= */
// Normaliza base: força HTTPS e remove '/manager'
function normalizeEvolutionBase(u){
  let s = String(u||'https://zap.iadmin.app').trim();
  if(!/^https?:\/\//i.test(s)) s = 'https://' + s;
  s = s.replace(/^http:\/\//i, 'https://');
  s = s.replace(/\/manager(\/.*)?$/i, '');
  s = s.replace(/\/+$/,'');
  return s;
}

// ---- connections normalization (failover) ----
function normalizeConnections(profile){
  const out = [];
  const arr = Array.isArray(profile?.connections) ? profile.connections : [];
  for(const c of arr){
    const base = normalizeEvolutionBase(c?.base);
    const instance = String(c?.instance||'').trim();
    const token = String(c?.token||'').trim();
    if(base && instance && token){
      out.push({ base, instance, token, label: `${base}|${instance}` });
    }
  }
  // fallback para credencial única
  if(!out.length){
    const base = normalizeEvolutionBase(profile?.evo_base_url || 'https://zap.iadmin.app');
    const instance = String(profile?.evo_instance||'').trim();
    const token = String(profile?.evo_token||'').trim();
    if(base && instance && token){
      out.push({ base, instance, token, label: `${base}|${instance}` });
    }
  }
  return out;
}

// ---- circuit breaker (in-memory) ----
const CB = new Map(); // key -> { fails, nextUpAt }
const CB_FAIL_LIMIT = 3;
const CB_COOLDOWN_MS = 10 * 60 * 1000;

function connKey(c){ return `${c.base}|${c.instance}`; }
function connIsDown(c){
  const k = connKey(c);
  const s = CB.get(k);
  return !!(s && s.nextUpAt && Date.now() < s.nextUpAt);
}
function markConnSuccess(c){
  const k = connKey(c);
  CB.delete(k);
}
function markConnFailure(c, critical){
  const k = connKey(c);
  const s = CB.get(k) || { fails:0, nextUpAt:0 };
  s.fails++;
  if(critical && s.fails >= CB_FAIL_LIMIT){
    s.nextUpAt = Date.now() + CB_COOLDOWN_MS;
    log('warn', `Circuit breaker: ${k} em cooldown por 10min`);
  }
  CB.set(k, s);
}

// erros “conexão crítica”: ban, auth, instância offline
function isCriticalConnError(resp){
  const s = Number(resp?.status||0);
  if([401,403,410,423].includes(s)) return true;
  const txt = (typeof resp?.data === 'string' ? resp.data : JSON.stringify(resp?.data||{})).toLowerCase();
  return [
    'banned','banido','blocked','bloqueado',
    'not authorized','forbidden','unauthorized',
    'instance not connected','notconnected','disconnected',
    'unavailable'
  ].some(x=> txt.includes(x));
}

// tenta enviar usando UMA conexão específica
async function evoRequestOnConn(conn, action, body){
  const base = conn.base;
  const inst = conn.instance;
  const token= conn.token;

  let actionNames = [action];
  if(action === 'sendList'){
    actionNames = ['sendList','listMessage','sendListMessage','send_list','send_list_message'];
  }
  if(action === 'sendPoll'){
    actionNames = ['sendPoll','pollMessage','sendPollMessage','send_poll','createPoll','create_poll'];
  }

  const paths = [];
  for(const a of actionNames){
    if(inst) paths.push(`/message/${a}/${inst}`); // prioridade
    paths.push(`/message/${a}`);
    if(inst) paths.push(`/${a}/${inst}`);
    if(inst) paths.push(`/${inst}/${a}`);
    if(inst) paths.push(`/api/${a}/${inst}`);
    if(inst) paths.push(`/api/${inst}/${a}`);
    paths.push(`/api/${a}`);
  }

  const headers = { 'Content-Type':'application/json' };
  if(token){
    headers['apikey']        = token;              // principal
    headers['x-api-key']     = token;              // compat
    headers['Authorization'] = `Bearer ${token}`;  // compat
  }

  let last = {ok:false, status:0, data:null};
  for(const p of paths){
    const url = `${base}${p}`;
    log('debug', 'EVO try:', url);
    if(DRY_RUN){ return { ok:true, status:200, data:{dry:true, url, action, body}, _usedConnection: conn }; }
    const r = await fetchJSON(url, { method:'POST', body: JSON.stringify(body), headers });
    last = r;
    if(r.ok) return { ...r, _usedConnection: conn };
  }
  return { ...last, _usedConnection: conn };
}

// API principal com failover entre conexões
async function evoRequest(profile, action, body){
  const conns = normalizeConnections(profile);
  if(!conns.length){
    return { ok:false, status:0, data:{ error:'No Evolution connection configured' } };
  }
  let last = null;
  for(const c of conns){
    if(connIsDown(c)){
      log('warn', `Conexão em cooldown, pulando: ${connKey(c)}`);
      continue;
    }
    const r = await evoRequestOnConn(c, action, body);
    if(r.ok){
      markConnSuccess(c);
      return r;
    }
    const critical = isCriticalConnError(r);
    markConnFailure(c, critical);
    last = r;
    if(!critical){
      // 4xx por payload, etc. Não adianta trocar conexão.
      return r;
    }
    // crítica: tenta próxima conexão
    log('warn', `Conexão falhou criticamente (${r.status}) em ${connKey(c)}; tentando próxima…`);
  }
  return last || { ok:false, status:0, data:{ error:'All connections failed or down' } };
}

/* ================== Helpers de arquivo ================== */
function guessMimeFrom(s, def="application/octet-stream"){
  s=(s||"").toLowerCase();
  if (s.endsWith(".jpg")||s.endsWith(".jpeg")) return "image/jpeg";
  if (s.endsWith(".png"))  return "image/png";
  if (s.endsWith(".webp")) return "image/webp";
  if (s.endsWith(".gif"))  return "image/gif";
  if (s.endsWith(".pdf"))  return "application/pdf";
  if (s.endsWith(".mp3"))  return "audio/mpeg";
  if (s.endsWith(".ogg") || s.endsWith(".opus") || s.endsWith(".oga")) return "audio/ogg";
  if (s.endsWith(".m4a"))  return "audio/mp4";
  if (s.endsWith(".aac"))  return "audio/aac";
  if (s.endsWith(".amr"))  return "audio/amr";
  if (s.endsWith(".wav"))  return "audio/wav";
  if (s.endsWith(".mp4"))  return "video/mp4";
  if (s.endsWith(".mov"))  return "video/quicktime";
  if (s.endsWith(".webm")) return "video/webm";
  if (s.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (s.endsWith(".doc"))  return "application/msword";
  if (s.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (s.endsWith(".xls"))  return "application/vnd.ms-excel";
  if (s.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (s.endsWith(".ppt"))  return "application/vnd.ms-powerpoint";
  if (s.endsWith(".txt"))  return "text/plain";
  return def;
}
function inferFilename(u,f){
  try{ const url=new URL(u); const last=url.pathname.split('/').pop(); if(last) return decodeURIComponent(last);}catch(_){}
  return f||'file';
}

/* ========== Tokens {{nome}} e {{data}} (Fortaleza) ========== */
function todayDDMMYYYYFortaleza(){
  const d = new Date();
  try{
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Fortaleza',
      day: '2-digit', month: '2-digit', year: 'numeric'
    }).formatToParts(d);
    const dd = parts.find(p=>p.type==='day')?.value ?? String(d.getDate()).padStart(2,'0');
    const mm = parts.find(p=>p.type==='month')?.value ?? String(d.getMonth()+1).padStart(2,'0');
    const yy = parts.find(p=>p.type==='year')?.value ?? String(d.getFullYear());
    return `${dd}.${mm}.${yy}`;
  }catch(_){
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yy = d.getFullYear();
    return `${dd}.${mm}.${yy}`;
  }
}

// resolve básico ({{nome}} / {{data}}), tolerante a espaços e também com 1-chaveta como fallback
function resolveTokens(text, contactName=''){
  const date = todayDDMMYYYYFortaleza();
  let out = String(text ?? '');
  out = out.replace(/\{\{\s*nome\s*\}\}/gi, String(contactName || ''));
  out = out.replace(/\{\{\s*data\s*\}\}/gi, date);
  // fallbacks (caso alguém tenha usado {nome} / {data})
  out = out.replace(/\{\s*nome\s*\}/gi, String(contactName || ''));
  out = out.replace(/\{\s*data\s*\}/gi, date);
  return out;
}

// aplica resolveTokens em qualquer estrutura
function applyTokensDeep(val, name){
  if (val == null) return val;
  if (typeof val === 'string') return resolveTokens(val, name);
  if (Array.isArray(val)) return val.map(v => applyTokensDeep(v, name));
  if (typeof val === 'object') {
    const out = Array.isArray(val) ? [] : {};
    for (const k of Object.keys(val)) out[k] = applyTokensDeep(val[k], name);
    return out;
  }
  return val;
}

/* ====== Agrupamento (empresa/instância) para 1 job por empresa ====== */
function jobGroupKey(q){
  const p = (q?.payload_json?.profile) || {};
  // prioridade: company_id > company > tenant > evo_company > evo_instance
  const key = p.company_id || p.company || p.tenant || p.evo_company || p.evo_instance || 'default';
  return String(key).trim();
}

/* =============== Montagem dos payloads por bloco =============== */
function buildPayloadForBlock(blk, numberE164, contactName=''){
  const rawType   = String(blk?.type   ?? '').trim().toLowerCase();
  const rawAction = String(blk?.action ?? '').trim().toLowerCase();
  const data  = blk?.data || {};

  const numberPlain = asEvolutionNumber(numberE164);

  // ---- Detecta LIST e POLL por type OU action (sinônimos) ----
  const isList =
    ['list','lista','whatsapp_list','listmessage','sendlistmessage'].includes(rawType) ||
    ['sendlist','send_list','listmessage','sendlistmessage'].includes(rawAction);

  const isPoll =
    ['poll','enquete','whatsapp_poll'].includes(rawType) ||
    ['sendpoll','pollmessage','sendpollmessage','createpoll','create_poll','send_poll'].includes(rawAction);

  // ===== TEXT & LINK =====
  if(rawType==='text' || (!rawType && !isList && !isPoll && !data.url)){
    return { action: 'sendText', body: { number:numberPlain, text: data.text ?? '', linkPreview: !!data.linkPreview } };
  }
  if(rawType==='link'){
    const parts=[data.title||'', data.url||'', data.description||''].filter(Boolean).join('\n');
    return { action: 'sendText', body: { number:numberPlain, text:parts, linkPreview:true } };
  }

  // ===== MEDIA =====
  if(['image','audio','video','document'].includes(rawType) && !(data.url||'').startsWith('http')){
    throw new Error(`Arquivo sem URL pública no bloco ${rawType}.`);
  }
  if(rawType==='image'){
    return { action:'sendMedia', body:{
      number:numberPlain, mediatype:'image',
      mimetype:(data._file&&data._file.type)||guessMimeFrom(data.url,'image/jpeg'),
      fileName:(data._file&&data._file.name)||inferFilename(data.url,'image'),
      caption: data.caption || '', media:data.url, presence:'composing'
    }};
  }
  if(rawType==='audio'){
    const mime = (data._file && data._file.type) || guessMimeFrom(data.url,'audio/mpeg');
    const url  = data.url;
    return { action:'sendMedia', body:{
      number:numberPlain, mediatype:'audio',
      mimetype: mime,
      fileName:(data._file&&data._file.name)||inferFilename(url,'audio'),
      media:url, presence:'recording'
    }};
  }
  if(rawType==='video'){
    return { action:'sendMedia', body:{
      number:numberPlain, mediatype:'video',
      mimetype:(data._file&&data._file.type)||guessMimeFrom(data.url,'video/mp4'),
      fileName:(data._file&&data._file.name)||inferFilename(data.url,'video'),
      caption: data.caption || '', media:data.url, presence:'composing'
    }};
  }
  if(rawType==='document'){
    return { action:'sendMedia', body:{
      number:numberPlain, mediatype:'document',
      mimetype:(data._file&&data._file.type)||guessMimeFrom(data.filename||data.url),
      fileName: data.filename || (data._file&&data._file.name) || inferFilename(data.url,'document'),
      caption: data.caption || '', media:data.url, presence:'composing'
    }};
  }

  // ===== LISTA (aceita sections OU options/values flat) =====
  if(isList){
    // normaliza rows a partir de diversas formas
    const fromOptions = (arr)=> (arr||[]).map((v,i)=>{
      if(v && typeof v==='object'){
        const title = v.title || v.text || v.name || String(v.value ?? v.label ?? '').trim();
        const description = v.description || v.subtitle || '';
        const rowId = v.rowId || v.id || v.value || String(i+1);
        const r={ rowId:String(rowId), title:String(title||`Opção ${i+1}`) };
        if(String(description).trim()!=='') r.description = String(description);
        return r;
      }
      return { rowId:String(i+1), title:String(v) };
    });

    let sections = [];
    if (Array.isArray(data.sections) && data.sections.length){
      sections = data.sections.map(sec => ({
        title: String(sec?.title || ''),
        rows: fromOptions(sec?.rows || [])
      }));
    } else {
      const flat = Array.isArray(data.values) ? data.values
                 : Array.isArray(data.options) ? data.options
                 : [];
      const rows = fromOptions(flat);
      sections = [{ title: String(data.sectionTitle || data.titleSection || ''), rows }];
    }

    // limite 10 itens mantendo ordem/seções
    const flat=[]; for(const s of sections){ for(const r of (s.rows||[])){ if(flat.length<10) flat.push({sectionTitle:s.title, ...r}); } }
    const limited=[]; let current=null, curTitle=null;
    for(const r of flat){
      if(r.sectionTitle!==curTitle){ current={title:r.sectionTitle||'', rows:[]}; limited.push(current); curTitle=r.sectionTitle; }
      const row={ rowId:r.rowId, title:r.title }; if(r.description) row.description=r.description; current.rows.push(row);
    }

    const title       = (data.title || 'Menu');
    const description = (data.description || '');
    const buttonText  = (data.buttonText || data.button || data.button_label || 'Abrir');
    const footerText  = (data.footer || data.footerText || '');

    const body = { number:numberPlain, title, buttonText, values: limited, sections: limited };
    if (String(description).trim()!=='') body.description = description;
    if (String(footerText).trim()!=='')  body.footerText  = footerText;

    return { action:'sendList', body };
  }

  // ===== ENQUETE (aceita várias chaves) =====
  if(isPoll){
    // coleta opções de diferentes formatos
    const pickStrings = (arr)=> (arr||[])
      .map((v)=>{
        if(v && typeof v==='object'){
          return String(v.title || v.text || v.name || v.value || v.label || '').trim();
        }
        return String(v||'').trim();
      })
      .filter(Boolean);

    let values = [];
    if (Array.isArray(data.values))  values = pickStrings(data.values);
    else if (Array.isArray(data.options)) values = pickStrings(data.options);
    else if (Array.isArray(data.choices)) values = pickStrings(data.choices);
    else if (Array.isArray(data.items))   values = pickStrings(data.items);
    else if (Array.isArray(data.rows))    values = pickStrings((data.rows||[]).map(r=>r?.title||r?.text||r?.name||''));

    // remove duplicados, limita 12
    values = values.filter((v,i)=>values.indexOf(v)===i).slice(0,12);
    if(values.length < 2) throw new Error('Enquete precisa de pelo menos 2 opções.');

    // nome da enquete
    const name = String(data.name || data.title || data.question || data.text || 'Enquete');

    // múltiplas escolhas
    let selectable = null;
    if (data.selectableCount != null) selectable = Number(data.selectableCount);
    else if (data.selectable != null) selectable = Number(data.selectable);
    else if (data.maxSelectable != null) selectable = Number(data.maxSelectable);
    else if (data.multiple === true || data.allowMultipleAnswers === true || data.multi === true) {
      selectable = values.length; // permite marcar todas
    }
    if (!selectable || Number.isNaN(selectable)) selectable = 1;
    selectable = clamp(selectable, 1, values.length);

    const body = { number: numberPlain, name, selectableCount: selectable, values };
    return { action:'sendPoll', body };
  }

  // ===== Fallback (não reconhecido) =====
  log('warn', 'Bloco não reconhecido; enviando fallback [tipo não suportado agora].', { rawType, rawAction });
  return { action: 'sendText', body: { number: numberPlain, text:'[tipo não suportado agora]' } };
}

/* ======================= Coleta de jobs ======================== */
async function loadQueued(limit=CONCURRENCY){
  const where = `(status,eq,queued)~and(is_paused,eq,false)`;
  const data = await queueList(where, limit, 'Id');
  const arr = Array.isArray(data?.list) ? data.list : [];
  return arr;
}
async function loadScheduledDue(limit=CONCURRENCY){
  const where = `(status,eq,scheduled)~and(is_paused,eq,false)`;
  const data = await queueList(where, limit*3, 'Id');
  const arr = Array.isArray(data?.list) ? data.list : [];
  const now = Date.now();
  return arr.filter(r=>{
    const ts = r.scheduled_for ? Date.parse(r.scheduled_for) : 0;
    return !ts || ts <= now;
  }).slice(0, limit);
}

/* ============== Retry inteligente: pular números falhos ============== */
async function computeSkipNumbersForRetry(queue){
  if(!queue?.retry_skip_failed) return [];
  let list = [];
  try{
    const byQ = await logsListByQueueId(queue.Id).catch(()=>null);
    list = Array.isArray(byQ?.list) ? byQ.list : [];
    if(!list.length && queue.run_id){
      const byRun = await logsListByRunId(queue.run_id).catch(()=>null);
      list = Array.isArray(byRun?.list) ? byRun.list : [];
    }
  }catch(_){}
  const failed = new Set();
  for(const l of list){
    const http = Number(l.http_status ?? l.http_code ?? 0);
    if(l.level==='error' || http>=400){
      const num = String(l.number || l.contact || '').trim();
      if(num) failed.add(num);
    }
  }
  return Array.from(failed);
}

/* ============== Guarda anti-duplicidade (2min) ============== */
const SENT_GUARD = new Map();
const SENT_TTL_MS = 2 * 60 * 1000;
function makeGuardKey(queueId, numberPlain, blockIx, action, body){
  const sample = body?.text || body?.caption || body?.media || JSON.stringify(body||{});
  return `${queueId}|${numberPlain}|${blockIx}|${action}|${sample}`;
}
function wasRecentlySent(key){
  const now = Date.now();
  const last = SENT_GUARD.get(key);
  if (SENT_GUARD.size > 5000) {
    for (const [k,t] of SENT_GUARD) if (now - t > SENT_TTL_MS) SENT_GUARD.delete(k);
  }
  if (last && (now - last) < SENT_TTL_MS) return true;
  SENT_GUARD.set(key, now);
  return false;
}

/* ====================== Processamento do job ====================== */
async function processQueueItem(q){
  const id = q.Id;
  log('info', `> Iniciando job #${id} (${q.name||''})`);

  const payload = q.payload_json || {};
  const profile = payload.profile || {};
  const contacts = Array.isArray(payload.contacts) ? payload.contacts.slice() : [];
  const blocks   = Array.isArray(payload.blocks)   ? payload.blocks.slice()   : [];
  const delays   = payload.delays || {};

  const normalized = contacts.map(c => ({
    name: (c.name || c.nome || c.first_name || c.fullname || 'Contato'),
    phone: ensureE164(c.phone || ''), // mantém E.164 internamente
    srcImported: !!c.srcImported,
    srcLabel: !!c.srcLabel,
  })).filter(c=>c.phone);

  const extraSkips = await computeSkipNumbersForRetry(q);
  const currentSkips = Array.isArray(payload.skipNumbers) ? payload.skipNumbers.slice() : [];
  const skipSet = new Set([...currentSkips, ...extraSkips]);

  if(q.retry_skip_failed){
    const newPayload = { ...payload, skipNumbers: Array.from(skipSet) };
    await queuePatch(id, { retry_skip_failed:false, payload_json: newPayload });
    q.payload_json = newPayload;
    log('info', `#${id} retry_skip_failed aplicado: pulando ${skipSet.size} números`);
  }

  await queuePatch(id, { status:'running', is_paused:false, progress_contact_ix: q.progress_contact_ix||0, progress_item_ix: q.progress_item_ix||0 });

  let okCount=0, errCount=0, processedContacts= q.progress_contact_ix || 0;

  // IMPORTANTE: Começa do contato onde parou (progress_contact_ix) ao invés de sempre começar do zero
  for(let ci=processedContacts; ci<normalized.length; ci++){
    const contact = normalized[ci];

    // Envolve TODO o processamento do contato em try-catch para erros não derrubarem a campanha
    try {
      const fresh = await queueGetOne(id).catch(()=>q);
      if(fresh?.is_paused || String((fresh?.status||'').toLowerCase())==='paused'){
        log('warn', `#${id} pausado durante execução.`);
        await queuePatch(id, { status:'paused', is_paused:true });
        return;
      }
      if(String((fresh?.status||'').toLowerCase())==='canceled'){
        log('warn', `#${id} cancelado.`);
        await queuePatch(id, { status:'canceled' });
        return;
      }

      if(skipSet.has(contact.phone)){
        log('debug', `#${id} pulando ${contact.phone} (skipNumbers)`);
        processedContacts++;
        try{ await queuePatch(id, { progress_contact_ix: processedContacts }); }catch(_){}
        continue;
      }

      for(let bi=0; bi<blocks.length; bi++){
        const blk = blocks[bi];
        const waitThis = Number(blk.itemWait ?? jitter(delays.itemDelay||0, delays.itemVariance||0));
        try{
          // monta payload bruto (robusto a type/action)
          const tmp   = buildPayloadForBlock(blk, contact.phone, contact.name);
          const action= tmp.action;

          // ======= APLICAÇÃO FINAL DE TOKENS =======
          let body = applyTokensDeep(tmp.body, contact.name);

          // se ainda restou algum {{token}}, tenta forçar mais uma passada
          const hasRaw = JSON.stringify(body).match(/\{\{?\s*(nome|data)\s*\}?\}/i);
          if (hasRaw) body = applyTokensDeep(body, contact.name);

          // ======= DEDUPE GUARD =======
          const numPlain = asEvolutionNumber(contact.phone);
          const gkey = makeGuardKey(id, numPlain, bi, action, body);
          if (wasRecentlySent(gkey)) {
            log('warn', `#${id} guard: conteúdo duplicado p/ ${numPlain} bi=${bi} — pulando envio.`);
          try{
            await logsCreate({
              queue_id: id,
              run_id: q.run_id || null,
              contact: contact.name || null,
              number: numPlain,
              http_status: 0,
              level: 'info',
              block_index: bi,
              message_json: truncateJSON({ guarded:true, reason:'duplicate_recent', action, body })
            });
          }catch(logErr){ log('error', `Falha ao criar log (guard): ${logErr.message}`); }
            continue;
          }

          log('debug', `#${id} -> ${contact.phone} :: ${action} bi=${bi}`);

          const resp = await evoRequest(profile, action, body);
          const http = resp.status||0;
          const ok = resp.ok;

          try{
            await logsCreate({
              queue_id: id,
              run_id: q.run_id || null,
              contact: contact.name || null,
              number: numPlain,
              http_status: http,
              level: ok ? 'info' : 'error',
              block_index: bi,
              message_json: truncateJSON({
                action, body, response: resp.data, status:http,
                used_connection: resp._usedConnection ? {
                  base: resp._usedConnection.base,
                  instance: resp._usedConnection.instance
                } : null
              })
            });
          }catch(logErr){ log('error', `Falha ao criar log: ${logErr.message}`); }

          if(ok) okCount++; else errCount++;

        }catch(e){
          errCount++;
          try{
            await logsCreate({
              queue_id: id,
              run_id: q.run_id || null,
              contact: contact.name || null,
              number: asEvolutionNumber(contact.phone),
              http_status: 0,
              level: 'error',
              block_index: bi,
              message_json: truncateJSON({ error: String(e&&e.message||e) })
            });
          }catch(logErr){ log('error', `Falha ao criar log de erro: ${logErr.message}`); }
        }

        if(waitThis>0) await sleep(waitThis*1000);
      }

      processedContacts++;
      try{ await queuePatch(id, { progress_contact_ix: processedContacts }); }catch(_){}

      const waitContact = jitter(delays.contactDelay||0, delays.contactVariance||0);
      if(waitContact>0) await sleep(waitContact*1000);
      
    } catch(contactError) {
      // Se houver QUALQUER erro ao processar este contato, registra mas CONTINUA para o próximo
      log('error', `#${id} Erro ao processar contato ${contact.phone}: ${contactError.message}`);
      errCount++;
      processedContacts++;
      try{ await queuePatch(id, { progress_contact_ix: processedContacts }); }catch(_){}
    }
  }

  const finalStatus = (okCount>0 || normalized.length===0) ? 'done' : 'failed';
  await queuePatch(id, { status: finalStatus, is_paused:false });
  log('info', `< Finalizado #${id}: ok=${okCount} err=${errCount} => ${finalStatus}`);
}

/* ====================== Loop principal (pool por empresa) ======================= */
let running = false;
async function tick(){
  if(running) return;
  running = true;
  try{
    // scheduled -> queued
    const due = await loadScheduledDue(CONCURRENCY);
    for(const item of due){
      await queuePatch(item.Id, { status:'queued' });
      log('debug', `scheduled->queued #${item.Id}`);
    }

    // buscar mais itens do que a concorrência para permitir variedade de empresas
    const batchSize = Math.max(CONCURRENCY * 8, CONCURRENCY);
    const queued = await loadQueued(batchSize);
    if(!queued.length){
      log('debug', 'Nenhum job para processar.');
      return;
    }

    // Agrupar por empresa/instância e pegar no máximo 1 por grupo
    const groups = new Map(); // groupKey -> array de jobs
    for(const q of queued){
      const gk = jobGroupKey(q);
      if(!groups.has(gk)) groups.set(gk, []);
      groups.get(gk).push(q);
    }
    // ordena cada grupo por Id crescente (mais antigo primeiro)
    for(const arr of groups.values()){
      arr.sort((a,b)=> Number(a.Id)-Number(b.Id));
    }

    // Seleciona até CONCURRENCY grupos distintos, 1 job por grupo
    const selected = [];
    for(const [gk, arr] of groups){
      if(selected.length >= CONCURRENCY) break;
      selected.push(arr[0]);
    }

    log('info', `Iniciando batch: ${selected.map(j=>`#${j.Id}(${jobGroupKey(j)})`).join(', ') || '—'}`);

    // Executar em paralelo (1 por empresa)
    await Promise.all(selected.map(async (q) => {
      try{
        await processQueueItem(q);
      }catch(e){
        log('error', `Falha no job #${q.Id}:`, e?.message||e);
        try{ await queuePatch(q.Id, { status:'failed' }); }catch(_){}
      }
    }));

  }catch(e){
    log('error', 'Tick error:', e?.message||e);
  }finally{
    running = false;
  }
}

(async function main(){
  log('info', '== Worker iniciado ==');
  log('info', { NOCO_URL, TABLE_SEND_QUEUE_ID, TABLE_SEND_LOGS_ID, POLL_INTERVAL_MS, CONCURRENCY, DRY_RUN });
  for(;;){
    await tick();
    await sleep(POLL_INTERVAL_MS);
  }
})();
