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
