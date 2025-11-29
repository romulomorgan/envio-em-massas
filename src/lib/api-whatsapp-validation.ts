// API de validação de números WhatsApp
// Usa endpoint da Evolution API para verificar se números possuem WhatsApp

import { queueGetOne } from './noco-api';

export interface WhatsAppValidationResult {
  number: string;
  exists: boolean;
  jid?: string;
  error?: string;
}

export interface BulkValidationResult {
  success: boolean;
  message: string;
  results: WhatsAppValidationResult[];
  validCount: number;
  invalidCount: number;
  errorCount: number;
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

// Remove caracteres não numéricos
function stripDigits(v: string): string {
  return String(v || '').replace(/[^\d]/g, '');
}

/**
 * Verifica se um único número possui WhatsApp
 */
export async function checkSingleWhatsAppNumber(
  base: string,
  instance: string,
  token: string,
  number: string
): Promise<WhatsAppValidationResult> {
  const result = await checkWhatsAppNumbers(base, instance, token, [number]);
  return result.results[0] || { number, exists: false, error: 'Sem resposta' };
}

/**
 * Verifica se uma lista de números possui WhatsApp
 * API: POST /chat/whatsappNumbers/{instance}
 * Body: { "numbers": ["5548999999999", ...] }
 */
export async function checkWhatsAppNumbers(
  base: string,
  instance: string,
  token: string,
  numbers: string[]
): Promise<BulkValidationResult> {
  const baseUrl = normalizeEvolutionBase(base);
  
  // Normaliza números (remove caracteres especiais)
  const normalizedNumbers = numbers.map(n => stripDigits(n)).filter(n => n.length >= 10);
  
  if (normalizedNumbers.length === 0) {
    return {
      success: false,
      message: 'Nenhum número válido para verificar',
      results: [],
      validCount: 0,
      invalidCount: 0,
      errorCount: 0
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': token,
    'x-api-key': token,
    'Authorization': `Bearer ${token}`
  };

  // Tenta múltiplos paths
  const paths = [
    `/chat/whatsappNumbers/${instance}`,
    `/instance/whatsappNumbers/${instance}`,
    `/misc/whatsappNumbers/${instance}`
  ];

  let lastError: any = null;

  for (const path of paths) {
    const url = `${baseUrl}${path}`;
    console.log('[WhatsApp Validation] Tentando:', url);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ numbers: normalizedNumbers })
      });

      const text = await response.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }

      if (response.ok && data) {
        console.log('[WhatsApp Validation] ✅ Resposta:', data);
        return parseValidationResponse(data, normalizedNumbers);
      }

      lastError = { status: response.status, data };
      console.log('[WhatsApp Validation] ❌ Erro:', response.status, data);
    } catch (e) {
      console.error('[WhatsApp Validation] Erro de rede:', e);
      lastError = { error: String(e) };
    }
  }

  return {
    success: false,
    message: `Falha ao verificar números: ${JSON.stringify(lastError)}`,
    results: normalizedNumbers.map(n => ({ number: n, exists: false, error: 'Verificação falhou' })),
    validCount: 0,
    invalidCount: 0,
    errorCount: normalizedNumbers.length
  };
}

/**
 * Parseia resposta da API Evolution para validação
 */
function parseValidationResponse(data: any, originalNumbers: string[]): BulkValidationResult {
  const results: WhatsAppValidationResult[] = [];
  let validCount = 0;
  let invalidCount = 0;
  let errorCount = 0;

  // A resposta pode vir em diferentes formatos dependendo da versão da Evolution
  // Formato 1: Array direto [{ exists: true, jid: "555199999999@s.whatsapp.net", number: "555199999999" }]
  // Formato 2: Objeto { "555199999999": { exists: true, jid: "..." } }
  // Formato 3: { results: [...] }

  let items: any[] = [];

  if (Array.isArray(data)) {
    items = data;
  } else if (data?.results && Array.isArray(data.results)) {
    items = data.results;
  } else if (typeof data === 'object' && !Array.isArray(data)) {
    // Formato objeto com números como chaves
    items = Object.entries(data).map(([num, info]: [string, any]) => ({
      number: num,
      ...info
    }));
  }

  // Cria um mapa de resultados
  const resultMap = new Map<string, WhatsAppValidationResult>();

  for (const item of items) {
    const number = stripDigits(item.number || item.phone || item.jid?.split('@')[0] || '');
    if (!number) continue;

    const exists = item.exists === true || 
                   item.valid === true || 
                   item.isWhatsApp === true ||
                   item.status === 'valid' ||
                   (item.jid && !item.jid.includes('lid'));

    const result: WhatsAppValidationResult = {
      number,
      exists,
      jid: item.jid || item.waid || undefined
    };

    if (!exists && item.error) {
      result.error = String(item.error);
    }

    resultMap.set(number, result);

    if (exists) {
      validCount++;
    } else {
      invalidCount++;
    }
  }

  // Garante que todos os números originais estejam no resultado
  for (const num of originalNumbers) {
    if (!resultMap.has(num)) {
      resultMap.set(num, {
        number: num,
        exists: false,
        error: 'Número não encontrado na resposta'
      });
      errorCount++;
    }
  }

  // Ordena pelo número original
  for (const num of originalNumbers) {
    const result = resultMap.get(num);
    if (result) {
      results.push(result);
    }
  }

  return {
    success: true,
    message: `Verificação concluída: ${validCount} válidos, ${invalidCount} inválidos`,
    results,
    validCount,
    invalidCount,
    errorCount
  };
}

/**
 * Verifica números de uma campanha usando as credenciais salvas
 */
export async function validateCampaignNumbers(
  queueId: string | number,
  numbers: string[]
): Promise<BulkValidationResult> {
  try {
    const queue = await queueGetOne(queueId);
    if (!queue) {
      return {
        success: false,
        message: 'Campanha não encontrada',
        results: [],
        validCount: 0,
        invalidCount: 0,
        errorCount: 0
      };
    }

    const payload = queue.payload_json;
    const profile = payload?.profile;
    
    if (!profile) {
      return {
        success: false,
        message: 'Perfil de conexão não encontrado na campanha',
        results: [],
        validCount: 0,
        invalidCount: 0,
        errorCount: 0
      };
    }

    const evoBase = profile.evo_base_url || profile.base_url || profile.url || '';
    const evoInstance = profile.evo_instance || profile.instance || profile.instancia || '';
    const evoToken = profile.evo_apikey || profile.evo_token || profile.token || '';

    if (!evoBase || !evoInstance || !evoToken) {
      return {
        success: false,
        message: 'Credenciais da Evolution API incompletas',
        results: [],
        validCount: 0,
        invalidCount: 0,
        errorCount: 0
      };
    }

    return await checkWhatsAppNumbers(evoBase, evoInstance, evoToken, numbers);
  } catch (e: any) {
    console.error('[validateCampaignNumbers] Erro:', e);
    return {
      success: false,
      message: `Erro: ${e.message}`,
      results: [],
      validCount: 0,
      invalidCount: 0,
      errorCount: 0
    };
  }
}

/**
 * Determina se um erro é impeditivo (não deve reenviar) ou temporário (pode tentar novamente)
 */
export function isBlockingError(errorMessage: string, httpStatus?: number): boolean {
  const msg = (errorMessage || '').toLowerCase();
  
  // Erros impeditivos (não adianta reenviar)
  const blockingPatterns = [
    'not on whatsapp',
    'não é whatsapp',
    'número inválido',
    'invalid number',
    'not registered',
    'não registrado',
    'banned',
    'bloqueado',
    'banido',
    'does not exist',
    'não existe',
    'not found',
    'número não encontrado',
    'whatsapp inapto',
    'sem whatsapp'
  ];

  for (const pattern of blockingPatterns) {
    if (msg.includes(pattern)) {
      return true;
    }
  }

  // HTTP 404, 410 são erros de número não encontrado
  if (httpStatus === 404 || httpStatus === 410) {
    return true;
  }

  return false;
}

/**
 * Determina se um erro é temporário e pode ser retentado
 */
export function isRetryableError(errorMessage: string, httpStatus?: number): boolean {
  // Se é erro impeditivo, não é retentável
  if (isBlockingError(errorMessage, httpStatus)) {
    return false;
  }

  const msg = (errorMessage || '').toLowerCase();
  
  // Erros temporários (vale tentar novamente)
  const retryablePatterns = [
    'timeout',
    'tempo esgotado',
    'connection',
    'conexão',
    'network',
    'rede',
    'temporarily',
    'temporariamente',
    'rate limit',
    'too many',
    'aguarde',
    'try again',
    'tente novamente',
    '503',
    '502',
    '500',
    'server error',
    'internal error'
  ];

  for (const pattern of retryablePatterns) {
    if (msg.includes(pattern)) {
      return true;
    }
  }

  // HTTP 5xx são erros de servidor (temporários)
  if (httpStatus && httpStatus >= 500 && httpStatus < 600) {
    return true;
  }

  // HTTP 429 é rate limit (temporário)
  if (httpStatus === 429) {
    return true;
  }

  // Por padrão, se não é impeditivo e não reconhecemos, assume temporário
  return true;
}
