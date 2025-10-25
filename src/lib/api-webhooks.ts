// API e Webhooks do sistema
import { 
  WEBHOOK_LIST_LABELS,
  WEBHOOK_LIST_USERS, 
  WEBHOOK_LIST_GROUPS,
  WEBHOOK_LIST_GROUP_PARTICIPANTS,
  WEBHOOK_LIST_ENTS,
  CV_API_URL,
  CV_API_EMAIL,
  CV_API_TOKEN
} from './utils-envio';

// Carregar etiquetas do Chatwoot
export async function fetchLabels(adminApiKey: string, origin: string, accountId: string) {
  const response = await fetch(WEBHOOK_LIST_LABELS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      admin_apikey: adminApiKey,
      origin,
      account_id: accountId
    })
  });
  
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const raw = Array.isArray(data) ? data : (data?.labels || data?.payload || data?.data || []);
  
  return raw.map((x: any, i: number) => {
    const title = typeof x === 'string' ? x : (x?.title || x?.name || x?.label || '');
    const id = typeof x === 'string' ? x : (x?.id || title || String(i + 1));
    return { id: String(id), title: String(title), name: String(title) };
  }).filter((o: any) => o.title);
}

// Carregar usuários por etiquetas
export async function fetchUsersByLabels(
  origin: string,
  accountId: string,
  inboxId: string,
  conversationId: string,
  labels: Array<{ id: string; title: string }>
) {
  const response = await fetch(WEBHOOK_LIST_USERS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin, accountId, inboxId, conversationId, labels })
  });
  
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const arr = Array.isArray(data) ? data : (data?.users || data?.contatos || []);
  
  return arr.map((c: any) => ({
    name: c.name || c.nome || c.full_name || c.title || 'Sem nome',
    phone: c.phone || c.telefone || c.phone_number || c.identifier || c.whatsapp || ''
  })).filter((x: any) => x.phone);
}

// Carregar grupos do WhatsApp
export async function fetchGroups(profile: any) {
  const payload = {
    instancia: profile.evo_instance || '',
    url: profile.evo_base_url || '',
    token: profile.evo_apikey || profile.evo_token || ''
  };
  
  const response = await fetch(WEBHOOK_LIST_GROUPS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  
  // Flatten de formatos possíveis
  let raw: any[] = [];
  if (Array.isArray(data) && data.length && data.every(x => x && Array.isArray(x.groups))) {
    for (const blk of data) raw = raw.concat(blk.groups || []);
  } else if (Array.isArray(data?.groups)) {
    raw = data.groups;
  } else if (Array.isArray(data?.data?.groups)) {
    raw = data.data.groups;
  } else if (Array.isArray(data)) {
    raw = data;
  }
  
  // Normalização
  const groups = raw.map((g: any, idx: number) => {
    const id = String(g?.id ?? g?.group_id ?? g?.gid ?? g?.remoteJid ?? g?.jid ?? (g?.wid?.id) ?? (idx + 1));
    const name = String(g?.name ?? g?.title ?? g?.subject ?? g?.chat_name ?? g?.nome ?? `Grupo ${idx + 1}`);
    return { id, name };
  });
  
  // Dedup
  const seen = new Set();
  return groups.filter((g: any) => {
    if (seen.has(g.id)) return false;
    seen.add(g.id);
    return true;
  });
}

// Carregar participantes de grupos
export async function fetchGroupParticipants(
  origin: string,
  accountId: string,
  profile: any,
  groups: Array<{ id: string; name: string }>
) {
  const payload = {
    origin,
    account_id: accountId,
    profile: {
      id: profile.id,
      instancia: profile.evo_instance || profile.instance || profile.instancia || '',
      url: profile.evo_base_url || profile.base_url || profile.url || '',
      token: profile.evo_apikey || profile.evo_token || profile.token || ''
    },
    groups
  };
  
  const response = await fetch(WEBHOOK_LIST_GROUP_PARTICIPANTS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  
  let arr: any[] = [];
  if (Array.isArray(data)) {
    if (data.length && Array.isArray(data[0]?.participants)) arr = data[0].participants;
    else if (data.some(x => Array.isArray(x?.participants))) arr = data.flatMap(x => x?.participants || []);
    else if (Array.isArray(data[0])) arr = data[0];
    else arr = data;
  } else if (Array.isArray(data?.participants)) {
    arr = data.participants;
  } else if (Array.isArray(data?.data?.participants)) {
    arr = data.data.participants;
  } else if (Array.isArray(data?.users)) {
    arr = data.users;
  } else if (Array.isArray(data?.contacts)) {
    arr = data.contacts;
  }
  
  const digits = (v: string) => String(v || '').replace(/\D+/g, '');
  const own = digits(profile.whatsapp || profile.phone || profile.telefone || '');
  
  return arr.map((p: any) => {
    const id = p?.id || p?.wid || p?.number || p?.jid || (p?.user && p.user.id) || '';
    const phone = digits(id);
    const name = (p?.name || p?.nome || p?.pushName || p?.notify || '').trim() || 'Sem nome';
    return { name, phone };
  }).filter((x: any) => x.phone && (!own || digits(x.phone) !== own));
}

// Carregar empreendimentos
export async function fetchEmpreendimentos() {
  const headers = {
    accept: 'application/json',
    email: CV_API_EMAIL,
    token: CV_API_TOKEN
  };
  
  const response = await fetch(CV_API_URL, {
    method: 'GET',
    headers,
    mode: 'cors'
  });
  
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  
  let arr: any[] = [];
  if (Array.isArray(data)) {
    arr = data;
  } else if (data && typeof data === 'object') {
    const keys = ['items', 'data', 'results', 'result', 'content', 'rows', 'list', 'records', 'empreendimentos'];
    for (const k of keys) {
      if (Array.isArray(data?.[k])) {
        arr = data[k];
        break;
      }
    }
    if (!arr.length) {
      for (const v of Object.values(data)) {
        if (Array.isArray(v)) {
          arr = v as any[];
          break;
        }
      }
    }
  }
  
  return arr.map((raw: any, idx: number) => {
    if (typeof raw === 'string') {
      const name = raw.trim();
      return name ? { id: String(idx + 1), name, title: name } : null;
    }
    
    const idKeys = ['idEmpreendimento', 'id_empreendimento', 'codigoEmpreendimento', 'codigo', 'id'];
    const nameKeys = ['nome', 'name', 'title', 'empreendimento', 'nomeEmpreendimento'];
    
    let idCandidate: any = null;
    let nameCandidate: any = null;
    
    if (typeof raw === 'object') {
      for (const k of idKeys) {
        if (raw[k] != null && raw[k] !== '') {
          idCandidate = raw[k];
          break;
        }
      }
      for (const k of nameKeys) {
        if (raw[k] != null && String(raw[k]).trim() !== '') {
          nameCandidate = raw[k];
          break;
        }
      }
    }
    
    const id = String(idCandidate ?? (idx + 1));
    const name = String(nameCandidate ?? '').trim();
    
    return name ? { id, name, title: name } : null;
  }).filter(Boolean);
}

// Carregar usuários por empreendimentos
export async function fetchUsersByEmpreendimentos(
  origin: string,
  accountId: string,
  inboxId: string,
  conversationId: string,
  empreendimentos: Array<{ id: string; nome: string }>
) {
  // Payload exato do arquivo original
  const payload = {
    origin,
    accountId,
    inboxId,
    conversationId,
    empreendimentos
  };
  
  const response = await fetch(WEBHOOK_LIST_ENTS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const arr = Array.isArray(data) ? data : (data?.users || data?.contatos || []);
  
  return arr.map((c: any) => ({
    name: c.nome || c.name || c.full_name || c.titulo || 'Sem nome',
    phone: c.telefone || c.phone || c.phone_number || c.identifier || c.whatsapp || ''
  })).filter((x: any) => x.phone);
}

// Verificar status da conexão Evolution
export async function fetchConnectionStatus(profile: any): Promise<'open' | 'close' | 'connecting' | null> {
  try {
    const url = `${profile.evo_base_url}/instance/connectionState/${profile.evo_instance}`;
    const response = await fetch(url, {
      headers: {
        'apikey': profile.evo_apikey || profile.evo_token || ''
      }
    });
    
    if (!response.ok) return null;
    const data = await response.json();
    const state = data?.state || data?.status || data?.connectionState || '';
    
    if (state.toLowerCase().includes('open') || state.toLowerCase().includes('connect')) return 'open';
    if (state.toLowerCase().includes('close')) return 'close';
    if (state.toLowerCase().includes('connecting')) return 'connecting';
    
    return null;
  } catch {
    return null;
  }
}
