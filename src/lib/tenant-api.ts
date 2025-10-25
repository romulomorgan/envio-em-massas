// API para buscar configurações do tenant na tabela EMPRESAS_TOKENS
import { NOCO_URL, NOCO_TOKEN } from './config';

const EMPRESAS_TOKENS_TABLE_ID = 'mv4m28s2v1bs0me';
const EMPRESAS_TOKENS_VIEW_ID = 'vwvmrsd2sbbilhfq';

export interface TenantData {
  admin_name?: string;
  admin_email?: string;
  admin_api_key?: string;
  cv_email?: string;
  cv_api_key?: string;
  cv_url?: string;
  is_active?: boolean;
  cv_active?: boolean;
  nocodb_api_key?: string;
  account_id?: string;
  chatwoot_origin?: string;
}

/**
 * Busca dados do tenant na tabela EMPRESAS_TOKENS
 * Filtra por account_id e chatwoot_origin
 */
export async function fetchTenantData(
  accountId: string,
  origin: string
): Promise<TenantData | null> {
  try {
    console.log('[fetchTenantData] Buscando dados do tenant:', { accountId, origin });
    
    // Monta URL com filtros
    const where = `(account_id,eq,${accountId})~and(chatwoot_origin,eq,${origin})`;
    const url = `${NOCO_URL}/api/v2/tables/${EMPRESAS_TOKENS_TABLE_ID}/records?offset=0&limit=25&where=${encodeURIComponent(where)}&viewId=${EMPRESAS_TOKENS_VIEW_ID}`;
    
    console.log('[fetchTenantData] URL:', url);
    
    const response = await fetch(url, {
      headers: {
        'xc-token': NOCO_TOKEN,
        'accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.error('[fetchTenantData] Erro HTTP:', response.status);
      return null;
    }
    
    const data = await response.json();
    console.log('[fetchTenantData] Response:', data);
    
    const records = data?.list || [];
    
    if (records.length === 0) {
      console.warn('[fetchTenantData] Nenhum tenant encontrado');
      return null;
    }
    
    const record = records[0];
    
    // Normaliza nomes de campos (case-insensitive)
    const normalized: TenantData = {
      admin_name: record.admin_name || record.ADMIN_NAME || record.adminName,
      admin_email: record.admin_email || record.ADMIN_EMAIL || record.adminEmail,
      admin_api_key: record.admin_api_key || record.ADMIN_API_KEY || record.adminApiKey,
      cv_email: record.cv_email || record.CV_EMAIL || record.cvEmail,
      cv_api_key: record.cv_api_key || record.CV_API_KEY || record.cvApiKey,
      cv_url: record.cv_url || record.CV_URL || record.cvUrl,
      is_active: record.is_active || record.IS_ACTIVE || record.isActive,
      cv_active: record.cv_active || record.CV_ACTIVE || record.cvActive,
      nocodb_api_key: record.nocodb_api_key || record.NOCODB_API_KEY || record.nocodbApiKey,
      account_id: record.account_id || record.ACCOUNT_ID || record.accountId,
      chatwoot_origin: record.chatwoot_origin || record.CHATWOOT_ORIGIN || record.chatwootOrigin
    };
    
    console.log('[fetchTenantData] Dados normalizados:', normalized);
    
    return normalized;
  } catch (error) {
    console.error('[fetchTenantData] Erro:', error);
    return null;
  }
}
