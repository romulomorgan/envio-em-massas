// API de reenvio individual de mensagens
import { NOCO_URL, NOCO_TOKEN, TABLE_SEND_LOGS_ID } from './config';
import { queueGetOne, nocoPATCH, nocoPOST } from './noco-api';

// Helpers
const stripDigits = (v: string) => String(v || '').replace(/[^\d]/g, '');
const asEvolutionNumber = (num: string) => stripDigits(num);

function todayDDMMYYYY(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function resolveTokens(text: string, contactName: string = ''): string {
  const date = todayDDMMYYYY();
  let out = String(text ?? '');
  out = out.replace(/\{\{\s*nome\s*\}\}/gi, String(contactName || ''));
  out = out.replace(/\{\{\s*data\s*\}\}/gi, date);
  out = out.replace(/\{\s*nome\s*\}/gi, String(contactName || ''));
  out = out.replace(/\{\s*data\s*\}/gi, date);
  return out;
}

function guessMimeFrom(s: string, def = 'application/octet-stream'): string {
  s = (s || '').toLowerCase();
  if (s.endsWith('.jpg') || s.endsWith('.jpeg')) return 'image/jpeg';
  if (s.endsWith('.png')) return 'image/png';
  if (s.endsWith('.webp')) return 'image/webp';
  if (s.endsWith('.gif')) return 'image/gif';
  if (s.endsWith('.pdf')) return 'application/pdf';
  if (s.endsWith('.mp3')) return 'audio/mpeg';
  if (s.endsWith('.ogg') || s.endsWith('.opus')) return 'audio/ogg';
  if (s.endsWith('.m4a')) return 'audio/mp4';
  if (s.endsWith('.mp4')) return 'video/mp4';
  if (s.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (s.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return def;
}

function inferFilename(u: string, f: string = 'file'): string {
  try {
    const url = new URL(u);
    const last = url.pathname.split('/').pop();
    if (last) return decodeURIComponent(last);
  } catch {}
  return f;
}

// Normaliza base da Evolution
function normalizeEvolutionBase(u: string): string {
  let s = String(u || 'https://zap.iadmin.app').trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  s = s.replace(/^http:\/\//i, 'https://');
  s = s.replace(/\/manager(\/.*)?$/i, '');
  s = s.replace(/\/+$/, '');
  return s;
}

// ========================================
// Resultado da verificação de status do perfil
// ========================================
export interface ProfileStatusResult {
  available: boolean;
  status: 'online' | 'offline' | 'connecting' | 'unknown' | 'error';
  message: string;
  instanceName?: string;
}

// Verifica status da instância Evolution API
export async function checkProfileStatus(
  base: string,
  instance: string,
  token: string
): Promise<ProfileStatusResult> {
  const baseUrl = normalizeEvolutionBase(base);
  
  // Paths para verificar conexão
  const paths = [
    `/instance/connectionState/${instance}`,
    `/instance/connect/${instance}`,
    `/instance/fetchInstances?instanceName=${instance}`
  ];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': token,
    'x-api-key': token,
    'Authorization': `Bearer ${token}`
  };

  for (const path of paths) {
    const url = `${baseUrl}${path}`;
    console.log('[checkProfileStatus] Verificando:', url);
    
    try {
      const response = await fetch(url, { method: 'GET', headers });
      
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return {
            available: false,
            status: 'error',
            message: 'Token/API Key inválido ou sem permissão',
            instanceName: instance
          };
        }
        continue; // Tenta próximo path
      }
      
      const data = await response.json();
      console.log('[checkProfileStatus] Resposta:', data);
      
      // Analisa resposta do connectionState
      if (data?.instance?.state || data?.state) {
        const state = (data?.instance?.state || data?.state || '').toLowerCase();
        
        if (state === 'open' || state === 'connected') {
          return {
            available: true,
            status: 'online',
            message: 'Instância conectada e pronta para enviar',
            instanceName: instance
          };
        }
        
        if (state === 'connecting' || state === 'syncing') {
          return {
            available: false,
            status: 'connecting',
            message: 'Instância está conectando, aguarde...',
            instanceName: instance
          };
        }
        
        if (state === 'close' || state === 'disconnected' || state === 'qrcode') {
          return {
            available: false,
            status: 'offline',
            message: state === 'qrcode' 
              ? 'Instância desconectada - precisa escanear QR Code'
              : 'Instância desconectada',
            instanceName: instance
          };
        }
      }
      
      // Analisa resposta do fetchInstances
      if (Array.isArray(data)) {
        const inst = data.find((i: any) => 
          i.name === instance || i.instanceName === instance || i.instance?.instanceName === instance
        );
        
        if (inst) {
          const connStatus = inst.connectionStatus || inst.instance?.status || '';
          if (connStatus === 'open' || connStatus === 'connected') {
            return {
              available: true,
              status: 'online',
              message: 'Instância conectada',
              instanceName: instance
            };
          }
        } else {
          return {
            available: false,
            status: 'error',
            message: 'Instância não encontrada',
            instanceName: instance
          };
        }
      }
      
      // Se chegou aqui com resposta OK, assume disponível
      return {
        available: true,
        status: 'online',
        message: 'Instância disponível',
        instanceName: instance
      };
      
    } catch (e) {
      console.error('[checkProfileStatus] Erro:', e);
      continue; // Tenta próximo path
    }
  }

  return {
    available: false,
    status: 'unknown',
    message: 'Não foi possível verificar o status da instância',
    instanceName: instance
  };
}

// Busca e verifica status do perfil de uma campanha
export async function getCampaignProfileStatus(queueId: string | number): Promise<ProfileStatusResult> {
  try {
    const queue = await queueGetOne(queueId);
    if (!queue) {
      return {
        available: false,
        status: 'error',
        message: 'Campanha não encontrada'
      };
    }

    const payload = queue.payload_json;
    const profile = payload?.profile;
    
    if (!profile) {
      return {
        available: false,
        status: 'error',
        message: 'Perfil de conexão não encontrado na campanha'
      };
    }

    const evoBase = profile.evo_base_url || profile.base_url || profile.url || '';
    const evoInstance = profile.evo_instance || profile.instance || profile.instancia || '';
    const evoToken = profile.evo_apikey || profile.evo_token || profile.token || '';

    if (!evoBase || !evoInstance || !evoToken) {
      return {
        available: false,
        status: 'error',
        message: 'Credenciais da Evolution API incompletas'
      };
    }

    return await checkProfileStatus(evoBase, evoInstance, evoToken);
  } catch (e: any) {
    console.error('[getCampaignProfileStatus] Erro:', e);
    return {
      available: false,
      status: 'error',
      message: `Erro ao verificar: ${e.message}`
    };
  }
}

// Monta o payload para cada tipo de bloco
function buildPayloadForBlock(blk: any, numberE164: string, contactName: string = '') {
  const rawType = String(blk?.type ?? '').trim().toLowerCase();
  const data = blk?.data || {};
  const numberPlain = asEvolutionNumber(numberE164);

  // TEXT
  if (rawType === 'text') {
    return { 
      action: 'sendText', 
      body: { 
        number: numberPlain, 
        text: resolveTokens(data.text ?? '', contactName),
        linkPreview: false 
      } 
    };
  }

  // LINK
  if (rawType === 'link') {
    const parts = [data.title || '', data.url || '', data.description || ''].filter(Boolean).join('\n');
    return { 
      action: 'sendText', 
      body: { 
        number: numberPlain, 
        text: resolveTokens(parts, contactName), 
        linkPreview: true 
      } 
    };
  }

  // IMAGE
  if (rawType === 'image') {
    return {
      action: 'sendMedia',
      body: {
        number: numberPlain,
        mediatype: 'image',
        mimetype: (data._file?.type) || guessMimeFrom(data.url, 'image/jpeg'),
        fileName: (data._file?.name) || inferFilename(data.url, 'image'),
        caption: resolveTokens(data.caption || '', contactName),
        media: data.url,
        presence: 'composing'
      }
    };
  }

  // AUDIO
  if (rawType === 'audio') {
    return {
      action: 'sendMedia',
      body: {
        number: numberPlain,
        mediatype: 'audio',
        mimetype: (data._file?.type) || guessMimeFrom(data.url, 'audio/mpeg'),
        fileName: (data._file?.name) || inferFilename(data.url, 'audio'),
        media: data.url,
        presence: 'recording'
      }
    };
  }

  // VIDEO
  if (rawType === 'video') {
    return {
      action: 'sendMedia',
      body: {
        number: numberPlain,
        mediatype: 'video',
        mimetype: (data._file?.type) || guessMimeFrom(data.url, 'video/mp4'),
        fileName: (data._file?.name) || inferFilename(data.url, 'video'),
        caption: resolveTokens(data.caption || '', contactName),
        media: data.url,
        presence: 'composing'
      }
    };
  }

  // DOCUMENT
  if (rawType === 'document') {
    return {
      action: 'sendMedia',
      body: {
        number: numberPlain,
        mediatype: 'document',
        mimetype: (data._file?.type) || guessMimeFrom(data.filename || data.url),
        fileName: data.filename || (data._file?.name) || inferFilename(data.url, 'document'),
        caption: resolveTokens(data.caption || '', contactName),
        media: data.url,
        presence: 'composing'
      }
    };
  }

  // LIST
  if (rawType === 'list' || rawType === 'lista') {
    const fromOptions = (arr: any[]) => (arr || []).map((v: any, i: number) => {
      if (v && typeof v === 'object') {
        const title = v.title || v.text || v.name || String(v.value ?? v.label ?? '').trim();
        const description = v.description || v.subtitle || '';
        const rowId = v.rowId || v.id || v.value || String(i + 1);
        const r: any = { rowId: String(rowId), title: String(title || `Opção ${i + 1}`) };
        if (String(description).trim() !== '') r.description = String(description);
        return r;
      }
      return { rowId: String(i + 1), title: String(v) };
    });

    let sections: any[] = [];
    if (Array.isArray(data.sections) && data.sections.length) {
      sections = data.sections.map((sec: any) => ({
        title: resolveTokens(String(sec?.title || ''), contactName),
        rows: fromOptions(sec?.rows || [])
      }));
    } else {
      const flat = Array.isArray(data.options) ? data.options :
                   Array.isArray(data.values) ? data.values :
                   Array.isArray(data.rows) ? data.rows : [];
      sections = [{ title: '', rows: fromOptions(flat) }];
    }

    return {
      action: 'sendList',
      body: {
        number: numberPlain,
        title: resolveTokens(String(data.title || 'Menu'), contactName),
        description: resolveTokens(String(data.description || ''), contactName),
        buttonText: resolveTokens(String(data.buttonText || 'Ver opções'), contactName),
        footerText: resolveTokens(String(data.footer || data.footerText || ''), contactName),
        sections
      }
    };
  }

  // POLL
  if (rawType === 'poll' || rawType === 'enquete') {
    return {
      action: 'sendPoll',
      body: {
        number: numberPlain,
        name: resolveTokens(String(data.name || data.title || 'Enquete'), contactName),
        values: (data.values || data.options || []).map((v: any) => String(v?.title || v?.text || v)),
        selectableCount: Number(data.selectableCount || 1)
      }
    };
  }

  throw new Error(`Tipo de bloco não suportado: ${rawType}`);
}

// Envia para a Evolution API
async function sendToEvolution(
  base: string, 
  instance: string, 
  token: string, 
  action: string, 
  body: any
): Promise<{ ok: boolean; status: number; data: any }> {
  const baseUrl = normalizeEvolutionBase(base);
  
  // Tenta múltiplos paths
  const paths = [
    `/message/${action}/${instance}`,
    `/message/${action}`,
    `/${action}/${instance}`
  ];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': token,
    'x-api-key': token,
    'Authorization': `Bearer ${token}`
  };

  let lastError: any = null;

  for (const path of paths) {
    const url = `${baseUrl}${path}`;
    console.log('[resend] Tentando:', url);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      const text = await response.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }

      if (response.ok) {
        console.log('[resend] ✅ Sucesso:', url);
        return { ok: true, status: response.status, data };
      }

      lastError = { ok: false, status: response.status, data };
    } catch (e) {
      console.error('[resend] Erro de rede:', e);
      lastError = { ok: false, status: 0, data: { error: String(e) } };
    }
  }

  return lastError || { ok: false, status: 0, data: { error: 'Todos os paths falharam' } };
}

// Atualiza ou cria log no NocoDB
async function updateLog(
  logId: string | number | null,
  queueId: string | number,
  runId: string,
  number: string,
  contactName: string,
  level: 'success' | 'error',
  httpStatus: number,
  messageJson: any
) {
  const logsBase = `/api/v2/tables/${TABLE_SEND_LOGS_ID}/records`;
  
  const payload = {
    queue_id: queueId,
    run_id: runId,
    number: number,
    contact_name: contactName,
    level,
    http_status: httpStatus,
    message_json: JSON.stringify(messageJson)
  };

  if (logId) {
    // Atualiza log existente
    await nocoPATCH(NOCO_URL + logsBase, { Id: logId, ...payload });
  } else {
    // Cria novo log
    await nocoPOST(NOCO_URL + logsBase, payload);
  }
}

export interface ResendResult {
  success: boolean;
  message: string;
  blocksTotal: number;
  blocksSent: number;
  blocksFailed: number;
  errors: string[];
}

// Função principal de reenvio individual
export async function resendToContact(
  queueId: string | number,
  targetNumber: string,
  targetName: string,
  existingLogId?: string | number | null,
  skipProfileCheck: boolean = false
): Promise<ResendResult> {
  console.log('[resend] Iniciando reenvio para:', targetNumber, 'Queue:', queueId);
  
  const result: ResendResult = {
    success: false,
    message: '',
    blocksTotal: 0,
    blocksSent: 0,
    blocksFailed: 0,
    errors: []
  };

  try {
    // 1. Busca dados da campanha
    const queue = await queueGetOne(queueId);
    if (!queue) {
      result.message = 'Campanha não encontrada';
      return result;
    }

    const payload = queue.payload_json;
    if (!payload) {
      result.message = 'Payload da campanha não encontrado';
      return result;
    }

    // 2. Extrai profile (conexão Evolution)
    const profile = payload.profile;
    if (!profile) {
      result.message = 'Perfil de conexão não encontrado na campanha';
      return result;
    }

    const evoBase = profile.evo_base_url || profile.base_url || profile.url || '';
    const evoInstance = profile.evo_instance || profile.instance || profile.instancia || '';
    const evoToken = profile.evo_apikey || profile.evo_token || profile.token || '';

    if (!evoBase || !evoInstance || !evoToken) {
      result.message = 'Credenciais da Evolution API incompletas';
      return result;
    }

    // 2.1 Verifica se o perfil está disponível (se não foi pulado)
    if (!skipProfileCheck) {
      console.log('[resend] Verificando status do perfil antes do envio...');
      const profileStatus = await checkProfileStatus(evoBase, evoInstance, evoToken);
      
      if (!profileStatus.available) {
        result.message = `Perfil indisponível: ${profileStatus.message}`;
        result.errors.push(profileStatus.message);
        return result;
      }
      console.log('[resend] ✅ Perfil disponível:', profileStatus.message);
    }

    // 3. Extrai blocos da campanha
    const blocks = payload.blocks || [];
    if (!blocks.length) {
      result.message = 'Nenhum bloco de mensagem encontrado na campanha';
      return result;
    }

    result.blocksTotal = blocks.length;

    // 4. Envia cada bloco
    const allResponses: any[] = [];
    
    for (let i = 0; i < blocks.length; i++) {
      const blk = blocks[i];
      console.log(`[resend] Enviando bloco ${i + 1}/${blocks.length}: ${blk.type}`);
      
      try {
        const { action, body } = buildPayloadForBlock(blk, targetNumber, targetName);
        const response = await sendToEvolution(evoBase, evoInstance, evoToken, action, body);
        
        allResponses.push({
          blockIndex: i,
          blockType: blk.type,
          action,
          response
        });

        if (response.ok) {
          result.blocksSent++;
          console.log(`[resend] ✅ Bloco ${i + 1} enviado com sucesso`);
        } else {
          result.blocksFailed++;
          const errorMsg = response.data?.error || response.data?.message || `HTTP ${response.status}`;
          result.errors.push(`Bloco ${i + 1} (${blk.type}): ${errorMsg}`);
          console.error(`[resend] ❌ Bloco ${i + 1} falhou:`, errorMsg);
        }

        // Delay entre blocos (500ms)
        if (i < blocks.length - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (e: any) {
        result.blocksFailed++;
        result.errors.push(`Bloco ${i + 1} (${blk.type}): ${e.message}`);
        console.error(`[resend] ❌ Erro no bloco ${i + 1}:`, e);
      }
    }

    // 5. Atualiza log no NocoDB
    const allSuccess = result.blocksSent === result.blocksTotal;
    const level = allSuccess ? 'success' : 'error';
    const httpStatus = allSuccess ? 200 : (allResponses.find(r => !r.response.ok)?.response.status || 500);
    
    try {
      await updateLog(
        existingLogId || null,
        queueId,
        queue.run_id || '',
        targetNumber,
        targetName,
        level,
        httpStatus,
        {
          action: 'resend',
          timestamp: new Date().toISOString(),
          blocksTotal: result.blocksTotal,
          blocksSent: result.blocksSent,
          blocksFailed: result.blocksFailed,
          responses: allResponses,
          errors: result.errors
        }
      );
      console.log('[resend] Log atualizado no NocoDB');
    } catch (e) {
      console.error('[resend] Erro ao atualizar log:', e);
    }

    // 6. Define resultado
    if (allSuccess) {
      result.success = true;
      result.message = `Todas as ${result.blocksTotal} mensagens foram enviadas com sucesso!`;
    } else if (result.blocksSent > 0) {
      result.success = false;
      result.message = `${result.blocksSent} de ${result.blocksTotal} mensagens enviadas. ${result.blocksFailed} falharam.`;
    } else {
      result.success = false;
      result.message = `Falha ao enviar todas as ${result.blocksTotal} mensagens.`;
    }

    return result;
  } catch (e: any) {
    console.error('[resend] Erro geral:', e);
    result.message = `Erro: ${e.message}`;
    return result;
  }
}
