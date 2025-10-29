// Utilitários do sistema de envio em massa

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function stripDigits(str: string): string {
  return String(str || '').replace(/[^\d]/g, '');
}

export function ensureE164(phone: string, defaultCountry: string = '55'): string {
  const digits = stripDigits(phone);
  if (!digits) return '';
  if (digits.startsWith('0')) return ensureE164(digits.slice(1), defaultCountry);
  if (digits.length >= 12) return '+' + digits;
  if (digits.length === 11 || digits.length === 10) return '+' + defaultCountry + digits;
  return '+' + digits;
}

export function formatPhoneLocal(phone: string): string {
  const e164 = ensureE164(phone);
  if (!e164) return phone;
  const digits = stripDigits(e164);
  if (digits.startsWith('55') && digits.length === 13) {
    const ddd = digits.substring(2, 4);
    const num = digits.substring(4);
    if (num.length === 9) return `(${ddd}) ${num.substring(0, 5)}-${num.substring(5)}`;
    if (num.length === 8) return `(${ddd}) ${num.substring(0, 4)}-${num.substring(4)}`;
  }
  return e164;
}

export function normalizeOrigin(origin: string): string {
  return String(origin || '').trim().replace(/\/+$/, '');
}

export function canonOrigin(origin: string): string {
  const o = normalizeOrigin(origin);
  if (!o) return '';
  try {
    const u = new URL(o);
    return (u.protocol + '//' + u.host).toLowerCase();
  } catch {
    return o.toLowerCase();
  }
}

export function getSafeContext() {
  if (typeof window === 'undefined') {
    return { origin: '', pathname: '', hash: '' };
  }
  return {
    origin: window.location?.origin || '',
    pathname: window.location?.pathname || '',
    hash: window.location?.hash || ''
  };
}

export function isHttpUrl(str: string): boolean {
  return /^https?:\/\//i.test(String(str || ''));
}

export function guessMimeFrom(url: string, fallback: string = 'application/octet-stream'): string {
  const ext = String(url || '').split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
    mp4: 'video/mp4', avi: 'video/x-msvideo', mov: 'video/quicktime',
    pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  return map[ext] || fallback;
}

export function inferFilename(url: string, fallback: string = 'arquivo'): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || fallback;
    return decodeURIComponent(last);
  } catch {
    return fallback;
  }
}

export function todayDDMMYYYY(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatBRDateTime(isoStr: string): string {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return isoStr;
  }
}

export function rand(base: number, variance: number): number {
  if (variance <= 0) return base;
  const min = Math.max(0, base - variance);
  const max = base + variance;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function normalizeAction(action: string): string {
  const map: Record<string, string> = {
    sendtext: 'sendText', sendmedia: 'sendMedia', sendlist: 'sendList', sendpoll: 'sendPoll'
  };
  const lower = String(action || '').toLowerCase().trim();
  return map[lower] || action || 'sendText';
}

export function downloadBlob(filename: string, data: string | ArrayBuffer, mimeType: string) {
  const blob = typeof data === 'string'
    ? new Blob([data], { type: mimeType })
    : new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Credenciais da API CV (empreendimentos)
export const CV_API_URL = 'https://lumis.cvcrm.com.br/api/cvio/empreendimento';
export const CV_API_EMAIL = 'integracao@integracao.com.br';
export const CV_API_TOKEN = '595582bb36d0cb139b11239f8b0852aa8baf1d49';

// Webhooks do sistema
export const WEBHOOK_LIST_LABELS = 'https://web.iadmin.ai/webhook/listar-etiquetas-empresas';
export const WEBHOOK_LIST_USERS = 'https://web.iadmin.ai/webhook/usuario-por-marcadores';
export const WEBHOOK_LIST_GROUPS = 'https://web.iadmin.ai/webhook/listar-grupos-do-whatsapp';
export const WEBHOOK_LIST_GROUP_PARTICIPANTS = 'https://web.iadmin.ai/webhook/listar-participantes-de-grupos';
export const WEBHOOK_LIST_ENTS = 'https://web.iadmin.ai/webhook/usuario-por-empreendimentos';

export function extractReasonFromLog(l: any): string {
  // Se level não for 'error', não há motivo de falha
  if (l?.level !== 'error') return '';
  
  // Tenta extrair do message_json
  let msgJson: any = null;
  if (typeof l?.message_json === 'string') {
    try {
      msgJson = JSON.parse(l.message_json);
    } catch (e) {
      // Se não conseguir parsear, usa o próprio texto como erro
      return l.message_json || 'Erro desconhecido';
    }
  } else if (typeof l?.message_json === 'object') {
    msgJson = l.message_json;
  }
  
  // Tenta extrair o erro do message_json
  if (msgJson) {
    // Erro direto
    if (msgJson.error) {
      return String(msgJson.error);
    }
    
    // Resposta de erro da API
    if (msgJson.response) {
      if (typeof msgJson.response === 'string') {
        return msgJson.response;
      }
      if (msgJson.response.error) {
        return String(msgJson.response.error);
      }
      if (msgJson.response.message) {
        return String(msgJson.response.message);
      }
    }
  }
  
  // Fallback para outros campos
  if (l?.error_message) return String(l.error_message);
  if (l?.error) return String(l.error);
  if (l?.reason) return String(l.reason);
  if (l?.message) return String(l.message);
  
  // Se http_status >= 400, usa o status como motivo
  const httpStatus = Number(l?.http_status || l?.http_code || 0);
  if (httpStatus >= 400) {
    return `HTTP ${httpStatus}`;
  }
  
  return 'Erro desconhecido';
}

export function extractNumberFromLog(l: any): string {
  // O backend salva o número diretamente no campo 'number'
  if (l?.number) {
    const cleaned = String(l.number).replace(/\D+/g, '');
    if (cleaned && cleaned.length >= 10) return cleaned;
  }
  
  // Fallback para outros campos
  const tryList = [
    l?.to, 
    l?.recipient, 
    l?.phone, 
    l?.telefone,
    l?.contact,
    l?.destination,
    l?.recipient_number
  ];
  
  for (const v of tryList) {
    if (v) {
      const cleaned = String(v).replace(/\D+/g, '');
      if (cleaned && cleaned.length >= 10) return cleaned;
    }
  }
  
  // Tenta extrair do message_json
  if (l?.message_json) {
    let msgJson: any = null;
    if (typeof l.message_json === 'string') {
      try {
        msgJson = JSON.parse(l.message_json);
      } catch (e) {
        // Ignora erros de parsing
      }
    } else if (typeof l.message_json === 'object') {
      msgJson = l.message_json;
    }
    
    if (msgJson?.body?.number) {
      const cleaned = String(msgJson.body.number).replace(/\D+/g, '');
      if (cleaned && cleaned.length >= 10) return cleaned;
    }
  }
  
  return '';
}
