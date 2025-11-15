import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { SectionTitle } from '@/components/SectionTitle';
import { Field } from '@/components/Field';
import { SmallBtn } from '@/components/SmallBtn';
import { EmojiTextarea } from '@/components/EmojiTextarea';
import { Pause, X, Download, Copy, Edit, Trash2, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { EmojiInput } from '@/components/EmojiInput';
import { WAPreview } from '@/components/WAPreview';
import { FileUpload } from '@/components/FileUpload';
import { ListEditor } from '@/components/ListEditor';
import { PollEditor } from '@/components/PollEditor';
import {
  uid,
  stripDigits,
  ensureE164,
  normalizeBrazilianPhone,
  validateAndNormalizeBrazilianPhone,
  formatPhoneLocal,
  getSafeContext,
  normalizeOrigin,
  canonOrigin,
  formatBRDateTime,
  rand,
  downloadBlob,
  isHttpUrl,
  normalizeAction,
  extractReasonFromLog,
  extractNumberFromLog
} from '@/lib/utils-envio';
import { supaRemove } from '@/lib/supabase-client';
import {
  WEBHOOK_LIST_USERS,
  WEBHOOK_LIST_ENTS,
  WEBHOOK_LIST_GROUPS,
  WEBHOOK_LIST_GROUP_PARTICIPANTS,
  WEBHOOK_LIST_LABELS,
  NOCO_TABLE_PROFILES_ID,
  NOCO_TENANT_TABLE_ID,
  NOCO_TENANT_VIEW_ID,
  NOCO_EMPRESAS_TOKENS_TABLE_ID,
  NOCO_URL,
  NOCO_TOKEN,
  TABLE_SEND_QUEUE_ID,
  TABLE_SEND_LOGS_ID
} from '@/lib/config';
import {
  queueCreate,
  queuePatch,
  queueDelete,
  queueGetOne,
  nocoGET,
  logsListByQueueId,
  logsListForRun
} from '@/lib/noco-api';
import {
  fetchLabels,
  fetchUsersByLabels,
  fetchGroups,
  fetchGroupParticipants,
  fetchEmpreendimentos,
  fetchUsersByEmpreendimentos,
  fetchConnectionStatus
} from '@/lib/api-webhooks';
import { Contact, Block, Label as LabelType, Group, Empreendimento, Profile, QueueRecord, TenantConfig } from '@/types/envio';

const TYPE_LABEL: Record<string, string> = {
  text: 'Texto',
  image: 'Imagem',
  audio: 'Áudio',
  video: 'Vídeo',
  document: 'Documento',
  link: 'Link',
  list: 'Lista',
  poll: 'Enquete'
};

function defaultsByType(type: string) {
  const defaults: Record<string, any> = {
    text: { text: '' },
    image: { url: '', caption: '' },
    audio: { url: '' },
    video: { url: '', caption: '' },
    document: { url: '', filename: '', caption: '' },
    link: { url: '', title: '', description: '' },
    list: {
      title: 'Menu',
      description: '',
      buttonText: 'Abrir',
      footer: '',
      sections: []
    },
    poll: { name: 'Enquete', values: [], selectableCount: 1 }
  };
  return defaults[type] || {};
}

const Index = () => {
  // Ambiente
  const { origin, pathname } = getSafeContext();
  
  // Extrai chatwoot_origin do referrer (documento pai do iframe)
  const refCtx = (() => {
    if (typeof document === 'undefined') return null;
    try {
      const ref = document.referrer || '';
      if (!ref) return null;
      const ru = new URL(ref);
      // chatwoot_origin = protocolo + hostname (até a 3ª barra)
      const chatwootOrigin = ru.origin; // https://chat.promobio.com.br
      return { 
        href: ref, 
        chatwootOrigin,
        pathname: ru.pathname 
      };
    } catch {
      return null;
    }
  })();
  
  const __forcedOrigin = (typeof window !== 'undefined' && (window as any).__FORCE_ORIGIN__) || refCtx?.chatwootOrigin || origin;
  const originNo = normalizeOrigin(__forcedOrigin);
  const originCanonInitial = canonOrigin(originNo);
  
  // Estado para originCanon (pode ser alterado pela detecção manual)
  const [originCanon, setOriginCanon] = useState(originCanonInitial);

  // IDs (simplificado - sem roteamento complexo do Chatwoot)
  const [accountId, setAccountId] = useState('');
  const [inboxId, setInboxId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [parentPathInfo, setParentPathInfo] = useState<{ href?: string; pathname?: string } | null>(null);
  const [appCtx, setAppCtx] = useState<any>(null);
  const [manualUrl, setManualUrl] = useState('');
  const [detectMsg, setDetectMsg] = useState('');

  // Estados principais
  const [tab, setTab] = useState('direct');
  const [status, setStatus] = useState('');
  const [listMode, setListMode] = useState('usuarios');

  // Debug
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLogs, setDebugLogs] = useState<Array<{ id: string; ts: string; scope: string; message: string; data?: any }>>([]);
  
  // Modal Detectar Perfil
  const [showDetectProfileModal, setShowDetectProfileModal] = useState(false);
  const [urlToDetect, setUrlToDetect] = useState('');
  const [followUpTab, setFollowUpTab] = useState<'scheduled'|'logs'>('scheduled');
  const mask = (v?: string, keep: number = 4) => {
    const s = String(v || '');
    return s ? `${s.slice(0, 3)}***${s.slice(-keep)}` : '';
  };
  const addDebug = (scope: string, message: string, data?: any) => {
    const ev = { id: uid(), ts: new Date().toISOString(), scope, message, data };
    setDebugLogs(prev => [ev, ...prev].slice(0, 200));
    try { console.log(`[debug:${scope}] ${message}`, data ?? ''); } catch {}
  };
  const copyDebug = () => {
    try {
      const blob = JSON.stringify(debugLogs, null, 2);
      navigator.clipboard?.writeText(blob);
      setStatus('Logs copiados para a área de transferência.');
    } catch {}
  };

  // Tenant config
  const [tenantConfig, setTenantConfig] = useState<TenantConfig | null>(null);
  const [hasChatwootAccess, setHasChatwootAccess] = useState<boolean | null>(null);
  const [hasCvAccess, setHasCvAccess] = useState<boolean | null>(null);
  const [empresasTokensData, setEmpresasTokensData] = useState<any>(null);

  // Perfis
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [profilesError, setProfilesError] = useState('');
  const [profilesStatus, setProfilesStatus] = useState<Record<string, 'open' | 'close' | 'connecting' | null>>({});

  // Campanha
  const [campaignName, setCampaignName] = useState('Campanha');

  // Labels/Etiquetas
  const [labels, setLabels] = useState<LabelType[]>([]);
  const [labelsBusy, setLabelsBusy] = useState(false);
  const [needSelectLabelHint, setNeedSelectLabelHint] = useState(false);
  const [selectedLabelIds, setSelectedLabelIds] = useState<(string | number)[]>([]);
  const [labelQuery, setLabelQuery] = useState('');

  // Grupos
  const [grupos, setGrupos] = useState<Group[]>([]);
  const [needSelectGroupHint, setNeedSelectGroupHint] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groupTarget, setGroupTarget] = useState('grupos');
  const [groupParticipantsBusy, setGroupParticipantsBusy] = useState(false);
  const [lastParticipantsEmpty, setLastParticipantsEmpty] = useState(false);
  const [forceShowUsersWithGroups, setForceShowUsersWithGroups] = useState(false);
  const [groupQuery, setGroupQuery] = useState('');

  // Empreendimentos
  const [empreendimentos, setEmpreendimentos] = useState<Empreendimento[]>([]);
  const [selectedEmpIds, setSelectedEmpIds] = useState<(string | number)[]>([]);
  const [empsBusy, setEmpsBusy] = useState(false);
  const [empQuery, setEmpQuery] = useState('');

  // Contatos
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [contactsPage, setContactsPage] = useState(1);
  const [contactSort, setContactSort] = useState<{ field: string; dir: 'asc' | 'desc' | 'normal' }>({
    field: 'checkbox',
    dir: 'normal'
  });
  const [contactQuery, setContactQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Blocos de mensagem
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [sampleName, setSampleName] = useState('João Silva');
  
  // Controle de visibilidade dos botões de mensagem (por padrão todos ocultos)
  const [blockButtonsVisibility, setBlockButtonsVisibility] = useState({
    text: false,
    image: false,
    video: false,
    audio: false,
    document: false,
    link: false,
    list: false,
    poll: false
  });

  // Agendamento e delays
  const [schedule, setSchedule] = useState('');
  const [defaultCountryCode, setDefaultCountryCode] = useState('55');
  const [itemDelay, setItemDelay] = useState(3);
  const [itemVariance, setItemVariance] = useState(4);
  const [contactDelay, setContactDelay] = useState(30);
  const [contactVariance, setContactVariance] = useState(300);

  // Envio
  const [sending, setSending] = useState(false);
  const [editingQueueId, setEditingQueueId] = useState<string | number | null>(null);
  const [currentTab, setCurrentTab] = useState<'criar' | 'acompanhar'>('criar');
  const [editMode, setEditMode] = useState<'none' | 'edit' | 'clone'>('none');
  
  // Confirmações de exclusão
  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; type: string; id?: string; callback?: () => void }>({ show: false, type: '' });
  
  // Confirmação de reenvio de pendentes
  const [resendConfirm, setResendConfirm] = useState<{ show: boolean; queueId: string | number | null; queueName: string }>({ show: false, queueId: null, queueName: '' });
  
  // Handler para download de contatos
  const handleDownloadContacts = (format: 'csv' | 'xls' | 'xlsx') => {
    if (!contacts || contacts.length === 0) {
      setStatus('Nenhum contato para exportar.');
      return;
    }
    
    const selectedContactsList = contacts.filter(c => selectedContacts.includes(c.id));
    const contactsToExport = selectedContactsList.length > 0 ? selectedContactsList : contacts;
    
    const excelData = contactsToExport.map(c => ({
      Nome: c.name || '',
      Telefone: c.phone || '',
      'Tags/Origem': c.tags || ''
    }));
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(wb, ws, 'Contatos');
    
    const fileName = `contatos_${Date.now()}.${format}`;
    XLSX.writeFile(wb, fileName, { bookType: format === 'csv' ? 'csv' : format as any });
    setStatus(`✅ Contatos exportados: ${fileName}`);
  };

  // Monitor
  const [queueRows, setQueueRows] = useState<QueueRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [monitorBusy, setMonitorBusy] = useState(false);
  const [queueSort, setQueueSort] = useState<{ field: string; dir: 'asc' | 'desc' | 'normal' }>({
    field: 'Id',
    dir: 'desc'
  });
  const [progressPctByQueue, setProgressPctByQueue] = useState<Record<string, number>>({});
  const [deliveredByQueue, setDeliveredByQueue] = useState<Record<string, number>>({});

  const pageSize = 10;
  const labelsReqRef = useRef<{ controller: AbortController | null }>({ controller: null });

  // Buscar dados da tabela EMPRESAS_TOKENS
  // CRÍTICO: Só executa quando tiver AMBOS: originCanon E accountId
  async function loadEmpresasTokens() {
    if (!originCanon || !accountId) {
      console.log('[empresasTokens] ❌ Aguardando detecção completa da URL...');
      console.log('[empresasTokens]   - originCanon:', originCanon || '❌ FALTANDO');
      console.log('[empresasTokens]   - accountId:', accountId || '❌ FALTANDO');
      setEmpresasTokensData(null);
      return null;
    }

    try {
      console.log('[empresasTokens] ✅ Buscando na tabela EMPRESAS_TOKENS com filtros:');
      console.log('[empresasTokens]   - originCanon:', originCanon);
      console.log('[empresasTokens]   - accountId:', accountId);
      addDebug('emp_tokens', 'GET EMPRESAS_TOKENS', { originCanon, accountId });
      
      const where = `(account_id,eq,${accountId})~and(chatwoot_origin,eq,${originCanon})`;
      const url = `${NOCO_URL}/api/v2/tables/${NOCO_EMPRESAS_TOKENS_TABLE_ID}/records?where=${encodeURIComponent(where)}&limit=25`;
      
      console.log('[empresasTokens] URL:', url);
      addDebug('emp_tokens', 'GET URL', { url });
      
      const data = await nocoGET(url);
      const list = Array.isArray(data?.list) ? data.list : [];
      
      console.log('[empresasTokens] Resposta completa:', list);
      addDebug('emp_tokens', 'Resposta EMPRESAS_TOKENS', { count: list.length, sample: list.slice(0, 2) });
      
      if (!list.length) {
        console.log('[empresasTokens] ❌ Nenhum registro encontrado');
        addDebug('emp_tokens', 'Nenhum registro encontrado');
        setEmpresasTokensData(null);
        return null;
      }
      
      const record = list[0];
      
      const empresasData = {
        cv_url: record.cv_url || '',
        cv_email: record.cv_email || '',
        cv_apikey: record.cv_apikey || '',
        is_active: !!(record.is_active === true || record.is_active === 'true' || record.is_active === 1),
        cv_active: !!(record.cv_active === true || record.cv_active === 'true' || record.cv_active === 1),
        // Visibilidade dos botões de mensagem (false por padrão se coluna não existir)
        // Nomes das colunas no NocoDB: Texto, Imagem, Video, Audio, Documento, Link, Lista, Enquete (primeira letra maiúscula)
        texto: record.Texto === undefined ? false : !!(record.Texto === true || record.Texto === 'true' || record.Texto === 1),
        imagem: record.Imagem === undefined ? false : !!(record.Imagem === true || record.Imagem === 'true' || record.Imagem === 1),
        video: record.Video === undefined ? false : !!(record.Video === true || record.Video === 'true' || record.Video === 1),
        audio: record.Audio === undefined ? false : !!(record.Audio === true || record.Audio === 'true' || record.Audio === 1),
        documento: record.Documento === undefined ? false : !!(record.Documento === true || record.Documento === 'true' || record.Documento === 1),
        link: record.Link === undefined ? false : !!(record.Link === true || record.Link === 'true' || record.Link === 1),
        lista: record.Lista === undefined ? false : !!(record.Lista === true || record.Lista === 'true' || record.Lista === 1),
        enquete: record.Enquete === undefined ? false : !!(record.Enquete === true || record.Enquete === 'true' || record.Enquete === 1)
      };
      
      console.log('[empresasTokens] ✅ Dados convertidos:', {
        cv_url: empresasData.cv_url ? '✅ presente' : '❌ vazio',
        cv_email: empresasData.cv_email ? '✅ presente' : '❌ vazio',
        cv_apikey: empresasData.cv_apikey ? `✅ ${empresasData.cv_apikey.slice(0, 5)}***` : '❌ vazio',
        'is_active (convertido)': empresasData.is_active,
        'cv_active (convertido)': empresasData.cv_active
      });
      addDebug('emp_tokens', 'Credenciais CV', {
        cv_url: empresasData.cv_url,
        cv_email: empresasData.cv_email ? '✅' : '❌',
        cv_apikey: mask(empresasData.cv_apikey),
        is_active: empresasData.is_active,
        cv_active: empresasData.cv_active
      });
      
      setEmpresasTokensData(empresasData);
      
      // Atualiza hasCvAccess baseado no cv_active da tabela EMPRESAS_TOKENS
      const cvAccess = empresasData.cv_active && empresasData.is_active;
      console.log('[empresasTokens] 🎯 CÁLCULO hasCvAccess:', {
        'cv_active': empresasData.cv_active,
        'is_active': empresasData.is_active,
        'cv_active && is_active': cvAccess,
        '⚠️ ATENÇÃO': cvAccess ? '✅ Empreendimentos LIBERADOS' : '❌ Empreendimentos BLOQUEADOS - Verifique cv_active e is_active na tabela!'
      });
      addDebug('emp_tokens', 'hasCvAccess calculado', { 
        cv_active: empresasData.cv_active,
        is_active: empresasData.is_active,
        hasCvAccess: cvAccess 
      });
      setHasCvAccess(cvAccess);
      
      // Atualiza visibilidade dos botões de mensagem
      setBlockButtonsVisibility({
        text: empresasData.texto,
        image: empresasData.imagem,
        video: empresasData.video,
        audio: empresasData.audio,
        document: empresasData.documento,
        link: empresasData.link,
        list: empresasData.lista,
        poll: empresasData.enquete
      });
      
      console.log('[empresasTokens] Visibilidade dos botões:', {
        texto: empresasData.texto,
        imagem: empresasData.imagem,
        video: empresasData.video,
        audio: empresasData.audio,
        documento: empresasData.documento,
        link: empresasData.link,
        lista: empresasData.lista,
        enquete: empresasData.enquete
      });
      
      return empresasData;
    } catch (e) {
      console.error('[empresasTokens] ❌ Erro:', e);
      addDebug('emp_tokens', 'Erro ao buscar EMPRESAS_TOKENS', { error: String(e) });
      setEmpresasTokensData(null);
      return null;
    }
  }

  // Carregar configuração do tenant (busca na tabela evo_profiles)
  // CRÍTICO: Só executa quando tiver AMBOS: originCanon E accountId detectados da URL
  async function loadTenantConfig() {
    // BLOQUEIO: Não busca sem ambos os valores
    if (!originCanon || !accountId) {
      console.log('[tenantConfig] ❌ Aguardando detecção completa da URL...');
      console.log('[tenantConfig]   - originCanon:', originCanon || '❌ FALTANDO');
      console.log('[tenantConfig]   - accountId:', accountId || '❌ FALTANDO');
      setTenantConfig(null);
      setHasChatwootAccess(false);
      setHasCvAccess(false);
      return null;
    }

    try {
      console.log('[tenantConfig] ========== INÍCIO DA BUSCA DO PERFIL ==========');
      console.log('[tenantConfig] ✅ originCanon detectado:', originCanon);
      console.log('[tenantConfig] ✅ accountId detectado:', accountId);
      addDebug('tenant', 'Query evo_profiles COM filtros completos', { originCanon, accountId });
      
      // BUSCA ÚNICA E PRECISA: Sempre com AMBOS os filtros (account_id AND chatwoot_origin)
      const where = `(account_id,eq,${accountId})~and(chatwoot_origin,eq,${originCanon})`;
      const url = `${NOCO_URL}/api/v2/tables/${NOCO_TABLE_PROFILES_ID}/records?offset=0&limit=25&where=${encodeURIComponent(where)}`;
      
      console.log('[tenantConfig] 🔍 Buscando perfil EXATO (account_id AND origin):');
      console.log('[tenantConfig]   - WHERE:', where);
      console.log('[tenantConfig]   - URL:', url);
      addDebug('tenant', 'GET evo_profiles (BUSCA PRECISA)', { url, where });
      
      const data = await nocoGET(url);
      
      if (!data || !Array.isArray(data.list) || data.list.length === 0) {
        console.error('[tenantConfig] ❌ NENHUM perfil encontrado com estes filtros!');
        console.error('[tenantConfig]   - Verifique se existe um registro na tabela evo_profiles com:');
        console.error('[tenantConfig]   - account_id =', accountId);
        console.error('[tenantConfig]   - chatwoot_origin =', originCanon);
        addDebug('tenant', 'ERRO: Nenhum perfil encontrado', { accountId, originCanon });
        setTenantConfig(null);
        setHasChatwootAccess(false);
        setHasCvAccess(false);
        return null;
      }

      console.log('[tenantConfig] ✅ Perfil(is) encontrado(s):', data.list.length);
      console.log('[tenantConfig] Registros:', data.list.map((r: any) => ({
        Id: r.Id,
        name: r.name || r.profile_name,
        account_id: r.account_id,
        chatwoot_origin: r.chatwoot_origin,
        admin_apikey: r.admin_apikey ? '✅ configurado' : '❌ não configurado'
      })));

      // Pega o primeiro registro (preferência para default=true)
      const chosen = data.list.find((r: any) => r.default === true || r.default === 'true' || r.default === 1) || data.list[0];
      
      console.log('[tenantConfig] ✅ Perfil selecionado:', chosen.name || chosen.profile_name || chosen.Id);
      console.log('[tenantConfig]   - account_id:', chosen.account_id);
      console.log('[tenantConfig]   - chatwoot_origin:', chosen.chatwoot_origin);
      console.log('[tenantConfig]   - admin_apikey:', chosen.admin_apikey ? '✅ PRESENTE' : '❌ AUSENTE');
      console.log('[tenantConfig]   - is_active:', chosen.is_active);

      const tenantData: TenantConfig = {
        id: String(chosen.Id || chosen.id || ''),
        chatwoot_origin: (chosen.chatwoot_origin || '').trim(),
        account_id: String(chosen.account_id || ''),
        admin_apikey: chosen.admin_apikey || '',
        is_active: !!(chosen.is_active === true || chosen.is_active === 'true' || chosen.is_active === 1),
        cv_activa: !!(chosen.cv_activa === true || chosen.cv_activa === 'true' || chosen.cv_activa === 1 || chosen.cv_active === true || chosen.cv_active === 'true' || chosen.cv_active === 1),
        default: !!(chosen.default === true || chosen.default === 'true' || chosen.default === 1),
        cv_email: chosen.cv_email || '',
        cv_apikey: chosen.cv_apikey || ''
      };

      addDebug('tenant', 'Perfil carregado com sucesso', {
        id: tenantData.id,
        account_id: tenantData.account_id,
        chatwoot_origin: tenantData.chatwoot_origin,
        has_admin_apikey: !!tenantData.admin_apikey,
        is_active: tenantData.is_active
      });

      setTenantConfig(tenantData);
      setHasChatwootAccess(!!(tenantData.admin_apikey && tenantData.is_active));
      
      // Expor variáveis globais
      if (typeof window !== 'undefined') {
        (window as any).__ADMIN_APIKEY__ = tenantData.admin_apikey || '';
        (window as any).__ACCOUNT_ID__ = String(accountId);
        (window as any).__INBOX_ID__ = String(inboxId || '');
        (window as any).__CONVERSATION_ID__ = String(conversationId || '');
        (window as any).__FORCE_ORIGIN__ = originCanon;
        
        console.log('[tenantConfig] 🌐 Variáveis globais atualizadas:', {
          __ADMIN_APIKEY__: tenantData.admin_apikey ? '✅ definido' : '❌ vazio',
          __ACCOUNT_ID__: accountId,
          __INBOX_ID__: inboxId || '(vazio)',
          __CONVERSATION_ID__: conversationId || '(vazio)'
        });
      }

      // Carrega dados da tabela EMPRESAS_TOKENS
      await loadEmpresasTokens();

      return tenantData;
    } catch (e) {
      console.error('[tenantConfig] ❌ Erro ao carregar perfil:', e);
      addDebug('tenant', 'ERRO ao carregar perfil', { error: String(e) });
      setTenantConfig(null);
      setHasChatwootAccess(false);
      setHasCvAccess(false);
      return null;
    }
  }

  // CRÍTICO: Só carrega tenant quando tiver AMBOS (originCanon E accountId)
  useEffect(() => {
    if (originCanon && accountId) {
      console.log('[useEffect:tenant] ✅ Condições atendidas, carregando tenant config...');
      loadTenantConfig();
    } else {
      console.log('[useEffect:tenant] ⏳ Aguardando detecção completa:', {
        originCanon: originCanon || '❌',
        accountId: accountId || '❌'
      });
    }
  }, [originCanon, accountId]);

  // Debug inicial
  useEffect(() => {
    console.log('='.repeat(80));
    console.log('🔧 CONFIGURAÇÃO NECESSÁRIA NO CHATWOOT (Dashboard App):');
    console.log('='.repeat(80));
    console.log('Para que este app detecte account_id e conversation_id automaticamente,');
    console.log('configure o Dashboard App no Chatwoot para enviar eventos via postMessage:');
    console.log('');
    console.log('window.postMessage({');
    console.log('  event: "chatwoot:ready",');
    console.log('  data: {');
    console.log('    account_id: 2,');
    console.log('    conversation: { id: 2176, inbox_id: 1 }');
    console.log('  }');
    console.log('}, "*");');
    console.log('');
    console.log('OU expor globalmente via: window.chatwootSDK = { account_id, conversation_id }');
    console.log('='.repeat(80));
    
    addDebug('init', 'Context detected on load', {
      originCanon,
      referrer: refCtx?.href,
      refChatwootOrigin: refCtx?.chatwootOrigin
    });
  }, [originCanon]);

  // Helper: extrai IDs do pathname do Chatwoot e também de query params
  function extractIdsFromPath(pathname: string) {
    const acc = pathname.match(/\/accounts\/(\d+)(?:\/|$)/i)?.[1] || '';
    const inbox = pathname.match(/\/inbox(?:es)?\/(\d+)(?:\/|$)/i)?.[1] || '';
    const conv = pathname.match(/\/conversations\/(\d+)(?:\/|$)/i)?.[1] || '';
    return { acc, inbox, conv };
  }

  function extractIdsFromUrl(u: URL) {
    // Primeiro, tenta pelos segmentos do path
    const fromPath = extractIdsFromPath(u.pathname);
    let { acc, inbox, conv } = fromPath;

    // Depois, tenta por query params comuns
    const sp = u.searchParams;
    const pick = (keys: string[]) => keys.map(k => sp.get(k) || '').find(v => /\d+/.test(v)) || '';

    if (!acc) acc = pick(['account_id', 'accountId', 'account', 'acc']);
    if (!inbox) inbox = pick(['inbox_id', 'inboxId', 'inbox']);
    if (!conv) conv = pick(['conversation_id', 'conversationId', 'conv']);

    // Normaliza para apenas dígitos
    acc = acc.replace(/[^\d]/g, '');
    inbox = inbox.replace(/[^\d]/g, '');
    conv = conv.replace(/[^\d]/g, '');

    return { acc, inbox, conv };
  }

  function applyIds(acc?: string, inbox?: string, conv?: string) {
    if (acc) setAccountId(acc);
    if (inbox) setInboxId(inbox);
    if (conv) setConversationId(conv);
    if (typeof window !== 'undefined') {
      if (acc) (window as any).__ACCOUNT_ID__ = acc;
      if (inbox) (window as any).__INBOX_ID__ = inbox;
      if (conv) (window as any).__CONVERSATION_ID__ = conv;
    }
    addDebug('detect', 'IDs applied from URL', { accountId: acc, inboxId: inbox, conversationId: conv });
  }

  // ============================================================================
  // 🚀 TÉCNICA ROBUSTA DE EXTRAÇÃO DE PARÂMETROS (Cascata com múltiplos fallbacks)
  // ============================================================================
  function extractContextRobust() {
    try {
      const pathname = window.location.pathname || '';
      const search = window.location.search || '';
      const hash = window.location.hash || '';
      const qs = new URLSearchParams(search);
      const hs = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
      
      // Helper para buscar em query/hash
      const get = (keys: string[]) => {
        for (const k of keys) {
          const v = qs.get(k) || hs.get(k);
          if (v !== null && v !== undefined && String(v).trim() !== '') 
            return String(v).trim();
        }
        return null;
      };
      
      // 1️⃣ EXTRAÇÃO PRIMÁRIA: Regex no Pathname
      // Funciona para: /accounts/2/inbox/9/conversations/1428 e /accounts/2/conversations/1429
      const accMatch = pathname.match(/\/accounts?\/(\d+)/i);
      const convMatch = pathname.match(/\/conversations?\/(\d+)/i);
      const inboxMatch = pathname.match(/\/inbox\/(\d+)/i);
      
      let acc = accMatch ? accMatch[1] : null;
      let conv = convMatch ? convMatch[1] : null;
      let inbox = inboxMatch ? inboxMatch[1] : null;
      
      console.log('[extractContextRobust] 1️⃣ Pathname extraction:', { pathname, acc, conv, inbox });
      
      // 2️⃣ FALLBACK: document.referrer (para iframes/embeds)
      if ((!acc || !conv) && document.referrer) {
        try {
          const refUrl = new URL(document.referrer);
          const refPath = refUrl.pathname || '';
          const accR = refPath.match(/\/accounts?\/(\d+)/i);
          const convR = refPath.match(/\/conversations?\/(\d+)/i);
          const inboxR = refPath.match(/\/inbox\/(\d+)/i);
          
          if (!acc && accR) acc = accR[1];
          if (!conv && convR) conv = convR[1];
          if (!inbox && inboxR) inbox = inboxR[1];
          
          console.log('[extractContextRobust] 2️⃣ Referrer fallback:', { refPath, acc, conv, inbox });
        } catch (e) {
          console.log('[extractContextRobust] ⚠️ Erro no referrer fallback:', e);
        }
      }
      
      // 3️⃣ FALLBACK FINAL: Query String/Hash
      if (!acc) acc = get(['acc','account_id','accountId','account']);
      if (!conv) conv = get(['conv','conversation_id','conversationId','id']);
      if (!inbox) inbox = get(['inbox','inbox_id','inboxId']);
      
      console.log('[extractContextRobust] 3️⃣ Query/Hash fallback:', { acc, conv, inbox });
      
      // 4️⃣ EXTRAÇÃO DO ORIGIN (cascata completa)
      let origin = get(['origin','chatwoot_origin','chatutilorigin','chatuiltorigin','chatuteorigin']);
      
      // Tenta referrer para origin
      if (!origin && document.referrer) {
        try { 
          const refUrl = new URL(document.referrer);
          origin = refUrl.origin;  // Ex: https://iudpgestao.com.br
          console.log('[extractContextRobust] 4️⃣ Origin do referrer:', origin);
        } catch {}
      }
      
      // Fallback: location.origin
      if (!origin) origin = window.location.origin;
      
      console.log('[extractContextRobust] ========== RESULTADO FINAL ==========');
      console.log('[extractContextRobust] accountId:', acc || '❌');
      console.log('[extractContextRobust] conversationId:', conv || '(não detectado)');
      console.log('[extractContextRobust] inboxId:', inbox || '(não detectado)');
      console.log('[extractContextRobust] origin:', origin || '❌');
      
      return { 
        acc: acc || '', 
        origin: origin || '', 
        conv: conv || '',
        inbox: inbox || ''
      };
    } catch (e) {
      console.error('[extractContextRobust] ❌ Erro geral:', e);
      return { acc: '', origin: '', conv: '', inbox: '' };
    }
  }

  function parseAndApplyFromUrl(raw: string) {
    try {
      const u = new URL(raw);
      setParentPathInfo({ href: u.href, pathname: u.pathname });
      
      // Usa a mesma lógica robusta de extração
      const pathname = u.pathname || '';
      const qs = new URLSearchParams(u.search);
      const hs = new URLSearchParams(u.hash.startsWith('#') ? u.hash.slice(1) : u.hash);
      
      const get = (keys: string[]) => {
        for (const k of keys) {
          const v = qs.get(k) || hs.get(k);
          if (v !== null && v !== undefined && String(v).trim() !== '') 
            return String(v).trim();
        }
        return null;
      };
      
      // Regex extraction
      const accMatch = pathname.match(/\/accounts?\/(\d+)/i);
      const convMatch = pathname.match(/\/conversations?\/(\d+)/i);
      const inboxMatch = pathname.match(/\/inbox\/(\d+)/i);
      
      const acc = accMatch ? accMatch[1] : get(['acc','account_id','accountId','account']);
      const conv = convMatch ? convMatch[1] : get(['conv','conversation_id','conversationId','id']);
      const inbox = inboxMatch ? inboxMatch[1] : get(['inbox','inbox_id','inboxId']);
      
      try { localStorage.setItem('cw_url_last', u.href); } catch {}
      addDebug('manual', 'Processando URL informada', { url: u.href, acc, conv, inbox });
      applyIds(acc || '', inbox || '', conv || '');
      setDetectMsg('URL processada com sucesso.');
    } catch (e: any) {
      setDetectMsg('URL inválida.');
    }
  }

  function tryReadTop() {
    try {
      // Pode falhar por cross-origin
      const href = (window.top && (window.top as any).location && (window.top as any).location.href) as string;
      if (href && /^https?:\/\//i.test(href)) {
        parseAndApplyFromUrl(href);
        return;
      }
      setDetectMsg('Não foi possível ler window.top.location (cross-origin).');
    } catch {
      setDetectMsg('Acesso negado ao topo (cross-origin). Use o campo abaixo ou aguarde appContext.');
    }
  }

  // ============================================================================
  // 🚀 DETECÇÃO AUTOMÁTICA ROBUSTA (executa uma única vez no mount)
  // Usa a técnica de cascata com múltiplos fallbacks
  // ============================================================================
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    console.log('[INIT] ========== INICIALIZANDO DETECÇÃO ROBUSTA ==========');
    
    // 0️⃣ PRIORIDADE MÁXIMA: Query param cw_url/chatwoot_url/url (URL passada manualmente)
    try {
      const sp = new URLSearchParams(window.location.search);
      const pasted = sp.get('cw_url') || sp.get('chatwoot_url') || sp.get('url');
      if (pasted) {
        console.log('[INIT] ✅ Query param encontrado, processando:', pasted);
        addDebug('init', 'URL via query param', { url: pasted });
        try { localStorage.setItem('cw_url_last', pasted); } catch {}
        parseAndApplyFromUrl(pasted);
        return; // Prioridade máxima, interrompe aqui
      }
    } catch {}
    
    // 1️⃣ Executa a extração robusta (pathname + referrer + query/hash)
    const result = extractContextRobust();
    
    console.log('[INIT] Resultado da extração robusta:', result);
    
    // 2️⃣ Aplica os resultados ou tenta fallback do localStorage
    if (result.acc) {
      console.log('[INIT] ✅ Aplicando accountId:', result.acc);
      setAccountId(result.acc);
      (window as any).__ACCOUNT_ID__ = result.acc;
      addDebug('detect', 'accountId detectado automaticamente', { accountId: result.acc });
      try { localStorage.setItem('cw_account_id', result.acc); } catch {}
    } else {
      console.error('[INIT] ❌ accountId NÃO DETECTADO pela técnica robusta!');
      console.error('[INIT] Tentando fallback do localStorage...');
      try {
        const savedAcc = localStorage.getItem('cw_account_id');
        if (savedAcc) {
          console.log('[INIT] ✅ Recuperado do localStorage:', savedAcc);
          setAccountId(savedAcc);
          (window as any).__ACCOUNT_ID__ = savedAcc;
          addDebug('detect', 'accountId recuperado do localStorage', { accountId: savedAcc });
        } else {
          // Último recurso: tenta última URL salva
          const lastUrl = localStorage.getItem('cw_url_last');
          if (lastUrl) {
            console.log('[INIT] 🔄 Tentando última URL salva:', lastUrl);
            addDebug('init', 'Usando cw_url_last como último recurso', { url: lastUrl });
            parseAndApplyFromUrl(lastUrl);
          }
        }
      } catch {}
    }
    
    if (result.conv) {
      console.log('[INIT] ✅ Aplicando conversationId:', result.conv);
      setConversationId(result.conv);
      (window as any).__CONVERSATION_ID__ = result.conv;
      addDebug('detect', 'conversationId detectado', { conversationId: result.conv });
    }
    
    if (result.inbox) {
      console.log('[INIT] ✅ Aplicando inboxId:', result.inbox);
      setInboxId(result.inbox);
      (window as any).__INBOX_ID__ = result.inbox;
      addDebug('detect', 'inboxId detectado', { inboxId: result.inbox });
    }
    
    console.log('[INIT] ========== DETECÇÃO CONCLUÍDA ==========');
    console.log('[INIT] Status final:', {
      accountId: result.acc || '❌',
      conversationId: result.conv || '(não detectado)',
      inboxId: result.inbox || '(não detectado)',
      origin: result.origin
    });
  }, []);

  // Re-tentativas agressivas: se não detectar via URL na primeira carga (devido a policy de referrer/cross-origin),
  // re-tenta por alguns segundos e solicita contexto ao parent via postMessage com vários event names conhecidos.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (accountId) return; // já temos

    let attempts = 0;
    const max = 20; // ~20s
    const timer = setInterval(() => {
      attempts++;

      // 1) Tenta novamente ler window.top.location.href
      try {
        const href = (window.top && (window.top as any).location && (window.top as any).location.href) as string;
        if (href && /^https?:\/\//i.test(href)) {
          try {
            const u = new URL(href);
            const ids = extractIdsFromUrl(u);
            if (ids.acc) {
              addDebug('retry', 'IDs extraídos de window.top em retry', { url: u.href, ...ids });
              applyIds(ids.acc, ids.inbox, ids.conv);
            }
          } catch {}
        }
      } catch {}

      // 2) Tenta novamente document.referrer (pode liberar o path após navegações internas)
      try {
        const ref = document.referrer || '';
        if (ref && ref.includes('/accounts/')) {
          const u = new URL(ref);
          const ids = extractIdsFromUrl(u);
          if (ids.acc) {
            addDebug('retry', 'IDs extraídos de document.referrer em retry', { url: u.href, ...ids });
            applyIds(ids.acc, ids.inbox, ids.conv);
          }
        }
      } catch {}

      // 3) Solicita contexto/URL ao parent com múltiplos event names
      try {
        if (window.parent && window.parent !== window) {
          const msgs = [
            { type: 'REQUEST_CHATWOOT_URL' },
            { type: 'GET_APP_CONTEXT' },
            { type: 'DASHBOARD_APP_CONTEXT' },
            { event: 'APP_CONTEXT_REQUEST' },
            { event: 'getContext' },
            { type: 'getContext' }
          ];
          msgs.forEach((m) => window.parent.postMessage(m as any, '*'));
        }
      } catch {}

      if (attempts >= max || (window as any).__ACCOUNT_ID__) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [accountId]);

  // CRÍTICO: Detecta contexto via window.chatwootSDK e window.parent.chatwoot (Dashboard Apps)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1) Tenta ler window.chatwootSDK (exposto pelo Chatwoot nos Dashboard Apps)
    const tryReadChatwootSDK = () => {
      try {
        const sdk = (window as any).chatwootSDK || (window as any).chatwoot;
        if (sdk && typeof sdk === 'object') {
          addDebug('sdk', 'window.chatwootSDK encontrado', sdk);
          const acc = sdk.account_id || sdk.accountId;
          const inbox = sdk.inbox_id || sdk.inboxId;
          const conv = sdk.conversation_id || sdk.conversationId || sdk.id;
          if (acc || conv) {
            addDebug('sdk', 'IDs via chatwootSDK', { acc, inbox, conv });
            applyIds(String(acc || ''), String(inbox || ''), String(conv || ''));
          }
        }
      } catch {}
    };

    // 2) Tenta ler window.parent.chatwoot (se parent expor)
    const tryReadParentChatwoot = () => {
      try {
        if (window.parent && window.parent !== window) {
          const parentCW = (window.parent as any).chatwoot || (window.parent as any).chatwootSDK;
          if (parentCW && typeof parentCW === 'object') {
            addDebug('sdk', 'parent.chatwoot encontrado', parentCW);
            const acc = parentCW.account_id || parentCW.accountId;
            const inbox = parentCW.inbox_id || parentCW.inboxId;
            const conv = parentCW.conversation_id || parentCW.conversationId || parentCW.id;
            if (acc || conv) {
              addDebug('sdk', 'IDs via parent.chatwoot', { acc, inbox, conv });
              applyIds(String(acc || ''), String(inbox || ''), String(conv || ''));
            }
          }
        }
      } catch {}
    };

    // 3) Polling periódico (caso SDK carregue depois)
    const pollInterval = setInterval(() => {
      tryReadChatwootSDK();
      tryReadParentChatwoot();
    }, 1000);

    // Executa imediatamente
    tryReadChatwootSDK();
    tryReadParentChatwoot();

    // Limpa após 10s
    setTimeout(() => clearInterval(pollInterval), 10000);

    return () => clearInterval(pollInterval);
  }, []);

  // Listener para eventos oficiais do Chatwoot Dashboard Apps (chatwoot:ready, chatwoot:conversation-changed)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onChatwootEvent = (e: MessageEvent) => {
      try {
        const d: any = e?.data;
        if (!d || typeof d !== 'object') return;

        const evt = String(d.event || d.type || '').toLowerCase();
        
        // Eventos oficiais do Dashboard App
        if (evt === 'chatwoot:ready' || evt === 'chatwoot:conversation-changed' || evt === 'chatwoot:contact-changed') {
          addDebug('chatwoot-event', `Evento ${evt} recebido`, d);
          
          const payload = d.data || d.payload || {};
          const conv = payload.conversation || payload.conversationDetails || {};
          const acc = String(conv.account_id || payload.account_id || payload.accountId || '');
          const inbox = String(conv.inbox_id || payload.inbox_id || payload.inboxId || '');
          const convId = String(conv.display_id || conv.id || payload.conversation_id || payload.conversationId || '');
          
          if (acc || convId) {
            addDebug('chatwoot-event', 'IDs extraídos do evento oficial', { acc, inbox, convId });
            applyIds(acc, inbox, convId);
          }
        }
      } catch (err) {
        console.error('[chatwoot-event] Erro ao processar evento:', err);
      }
    };

    window.addEventListener('message', onChatwootEvent);
    
    // Solicita contexto ao Chatwoot via eventos oficiais
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ event: 'chatwoot:context-request' }, '*');
        window.parent.postMessage({ type: 'chatwoot:context-request' }, '*');
        addDebug('chatwoot-event', 'Solicitando contexto via chatwoot:context-request');
      }
    } catch {}

    return () => window.removeEventListener('message', onChatwootEvent);
  }, []);

  // Listener para receber IDs via postMessage (fallback quando referrer não traz o pathname)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMsg = (e: MessageEvent) => {
      try {
        const d: any = e?.data;
        if (!d || (typeof d !== 'object' && typeof d !== 'string')) return;

        // 0) Eventos do Chatwoot (Dashboard Apps) – appContext com conversation/contact/currentAgent
        if (typeof d === 'object' && (d.event || d.type)) {
          const evt = String(d.event || d.type || '').toLowerCase();
          if (evt.includes('appcontext') || evt.includes('context')) {
            const payload: any = d.data || {};
            setAppCtx(payload);
            const conv = payload.conversation || payload.conversation_details || {};
            const toNumStr = (v: any) => (typeof v === 'number' && Number.isFinite(v)) ? String(v) : (typeof v === 'string' && /^\d+$/.test(v.trim()) ? v.trim() : '');
            const acc2 = toNumStr(conv.account_id || payload.account_id || payload.account?.id);
            const inbox2 = toNumStr(conv.inbox_id || payload.inbox_id);
            const conv2 = toNumStr(conv.display_id || conv.id || payload.conversation_id);
            
            addDebug('postMessage', 'appContext recebido', { 
              acc: acc2 || '(vazio)', 
              inbox: inbox2 || '(vazio)', 
              conv: conv2 || '(vazio)', 
              payload: { 
                conversation_id: conv.id, 
                account_id: conv.account_id || payload.account_id 
              } 
            });
            
            // IMPORTANTE: Só sobrescreve se ainda não tiver valores detectados da URL
            const currentAcc = (window as any).__ACCOUNT_ID__ || '';
            const currentInbox = (window as any).__INBOX_ID__ || '';
            const currentConv = (window as any).__CONVERSATION_ID__ || '';
            
            console.log('[postMessage:appContext] Comparando valores:', {
              'URL accountId': currentAcc || '(vazio)',
              'appContext accountId': acc2 || '(vazio)',
              'URL conversationId': currentConv || '(vazio)',
              'appContext conversationId': conv2 || '(vazio)'
            });
            
            if (acc2 && !currentAcc) {
              console.log('[postMessage:appContext] ✅ Usando accountId do appContext:', acc2);
              setAccountId(acc2);
              if (typeof window !== 'undefined') (window as any).__ACCOUNT_ID__ = acc2;
              addDebug('postMessage', 'accountId atualizado via appContext', { acc2 });
            } else if (acc2 && currentAcc !== acc2) {
              console.warn('[postMessage:appContext] ⚠️ CONFLITO: accountId do appContext DIFERENTE do detectado na URL!');
              console.warn('[postMessage:appContext] URL:', currentAcc, 'vs appContext:', acc2);
              console.warn('[postMessage:appContext] 🎯 MANTENDO o valor da URL (mais confiável):', currentAcc);
              addDebug('postMessage', '⚠️ accountId do appContext DIFERENTE do detectado - mantendo o da URL', { 
                urlValue: currentAcc, 
                appContextValue: acc2 
              });
            } else if (currentAcc && !acc2) {
              console.log('[postMessage:appContext] ℹ️ Já temos accountId da URL, appContext não tem - mantendo URL:', currentAcc);
            }
            
            if (inbox2 && !currentInbox) {
              setInboxId(inbox2);
              if (typeof window !== 'undefined') (window as any).__INBOX_ID__ = inbox2;
              addDebug('postMessage', 'inboxId atualizado via appContext', { inbox2 });
            }
            
            if (conv2 && !currentConv) {
              console.log('[postMessage:appContext] ✅ Usando conversationId do appContext:', conv2);
              setConversationId(conv2);
              if (typeof window !== 'undefined') (window as any).__CONVERSATION_ID__ = conv2;
              addDebug('postMessage', 'conversationId atualizado via appContext', { conv2 });
            } else if (!conv2 && currentConv) {
              console.log('[postMessage:appContext] ℹ️ Já temos conversationId da URL, appContext não tem - mantendo URL:', currentConv);
              addDebug('postMessage', '⚠️ appContext não tem conversationId - mantendo o da URL', { 
                urlValue: currentConv 
              });
            } else if (conv2 && currentConv !== conv2) {
              console.warn('[postMessage:appContext] ⚠️ CONFLITO: conversationId do appContext DIFERENTE do detectado na URL!');
              console.warn('[postMessage:appContext] URL:', currentConv, 'vs appContext:', conv2);
              console.warn('[postMessage:appContext] 🎯 MANTENDO o valor da URL (mais confiável):', currentConv);
            }
            
            return; // já tratou
          }
        }

        // 1) Se vier uma URL completa
        const maybeUrl = typeof d === 'string' ? d : (d.url || d.href || d.chatwoot_url || d.chatwoot_href);
        if (typeof maybeUrl === 'string' && /^https?:\/\//i.test(maybeUrl)) {
          try {
            const u = new URL(maybeUrl);
            setParentPathInfo({ href: u.href, pathname: u.pathname });
            const ids = extractIdsFromUrl(u);
            
            addDebug('postMessage', 'URL completa recebida', { url: u.href, ...ids });
            
            // Só atualiza se não tiver valores ou se forem iguais
            const currentAcc = (window as any).__ACCOUNT_ID__ || '';
            const currentInbox = (window as any).__INBOX_ID__ || '';
            const currentConv = (window as any).__CONVERSATION_ID__ || '';
            
            if (ids.acc && !currentAcc) {
              setAccountId(ids.acc);
              if (typeof window !== 'undefined') (window as any).__ACCOUNT_ID__ = ids.acc;
            }
            if (ids.inbox && !currentInbox) {
              setInboxId(ids.inbox);
              if (typeof window !== 'undefined') (window as any).__INBOX_ID__ = ids.inbox;
            }
            if (ids.conv && !currentConv) {
              setConversationId(ids.conv);
              if (typeof window !== 'undefined') (window as any).__CONVERSATION_ID__ = ids.conv;
            }
          } catch {}
        }

        // 2) Ou os IDs soltos
        const toNumStr = (v: any) => {
          if (typeof v === 'number' && Number.isFinite(v)) return String(v);
          if (typeof v === 'string' && /^\d+$/.test(v.trim())) return v.trim();
          return '';
        };
        const acc = toNumStr((d as any).account_id || (d as any).accountId || (d as any).acc);
        const inbox = toNumStr((d as any).inbox_id || (d as any).inboxId || (d as any).inbox);
        const conv = toNumStr((d as any).conversation_id || (d as any).conversationId || (d as any).conv);
        
        if (acc || inbox || conv) {
          addDebug('postMessage', 'IDs soltos recebidos', { acc: acc || '(vazio)', inbox: inbox || '(vazio)', conv: conv || '(vazio)' });
          
          // Só atualiza se não tiver valores
          const currentAcc = (window as any).__ACCOUNT_ID__ || '';
          const currentInbox = (window as any).__INBOX_ID__ || '';
          const currentConv = (window as any).__CONVERSATION_ID__ || '';
          
          if (acc && !currentAcc) {
            setAccountId(acc);
            if (typeof window !== 'undefined') (window as any).__ACCOUNT_ID__ = acc;
          }
          if (inbox && !currentInbox) {
            setInboxId(inbox);
            if (typeof window !== 'undefined') (window as any).__INBOX_ID__ = inbox;
          }
          if (conv && !currentConv) {
            setConversationId(conv);
            if (typeof window !== 'undefined') (window as any).__CONVERSATION_ID__ = conv;
          }
        }
      } catch {}
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Solicita periodicamente a URL completa ao parent (caso ele queira responder)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let id: any;
    const tick = () => {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'REQUEST_CHATWOOT_URL' }, '*');
        }
      } catch {}
    };
    id = setInterval(tick, 2000);
    tick();
    return () => clearInterval(id);
  }, []);

  // Nova função: Auto-detecta perfil válido testando contra API do Chatwoot
  async function autoDetectValidProfile(filterOrigin: string) {
    console.log('[Auto-Detect] 🔍 Iniciando busca de perfil válido para origin:', filterOrigin);
    
    try {
      // Busca TODOS os perfis deste origin (sem filtrar por account_id ainda)
      const whereCondition = `(chatwoot_origin,eq,${filterOrigin})`;
      const url = `${NOCO_URL}/api/v2/tables/${NOCO_TABLE_PROFILES_ID}/records?where=${encodeURIComponent(whereCondition)}&limit=1000`;
      
      console.log('[Auto-Detect] 📡 Consultando NocoDB:', url);
      const data = await nocoGET(url);
      const list = Array.isArray(data?.list) ? data.list : [];
      
      console.log('[Auto-Detect] ✅ Encontrados', list.length, 'perfis para testar');
      
      // PRIORIZA perfis com default=true (coloca eles primeiro na lista)
      const sortedList = [...list].sort((a, b) => {
        const aDefault = a.default === true || a.default === 'true' || a.default === 1;
        const bDefault = b.default === true || b.default === 'true' || b.default === 1;
        if (aDefault && !bDefault) return -1;
        if (!aDefault && bDefault) return 1;
        return 0;
      });
      
      console.log('[Auto-Detect] 🎯 Perfis ordenados (defaults primeiro)');
      
      // Testa cada perfil contra a API do Chatwoot
      for (const profile of sortedList) {
        const testAccountId = profile.account_id;
        const testAdminApiKey = profile.admin_apikey || profile.adimin_apikey || '';
        const isDefault = profile.default === true || profile.default === 'true' || profile.default === 1;
        
        if (!testAccountId || !testAdminApiKey) {
          console.log('[Auto-Detect] ⏭️ Perfil', profile.name, '- dados incompletos (sem account_id ou admin_apikey)');
          continue;
        }
        
        console.log('[Auto-Detect] 🧪 Testando perfil:', profile.name, isDefault ? '⭐ [DEFAULT]' : '', '(account_id:', testAccountId, ')');
        
        try {
          // Testa contra API do Chatwoot: GET /api/v1/profile
          const testUrl = `${filterOrigin}/api/v1/profile`;
          const response = await fetch(testUrl, {
            method: 'GET',
            headers: {
              'api_access_token': testAdminApiKey,
              'Content-Type': 'application/json'
            }
          });
          
          if (response.ok) {
            const profileData = await response.json();
            console.log('[Auto-Detect] ✅ PERFIL VÁLIDO ENCONTRADO!', profile.name, isDefault ? '⭐ (DEFAULT)' : '');
            console.log('[Auto-Detect] 📊 Dados retornados:', profileData);
            
            // Atualiza as variáveis globais com o perfil válido
            setAccountId(String(testAccountId));
            if (profile.inbox_id) {
              setInboxId(String(profile.inbox_id));
            }
            
            // Salva no localStorage
            try {
              localStorage.setItem('chatwoot_account_id', String(testAccountId));
              if (profile.inbox_id) {
                localStorage.setItem('chatwoot_inbox_id', String(profile.inbox_id));
              }
            } catch {}
            
            const statusMsg = isDefault 
              ? `⭐ Perfil padrão "${profile.name}" selecionado automaticamente`
              : `✅ Perfil "${profile.name}" detectado e validado`;
            setStatus(statusMsg);
            
            addDebug('auto-detect', 'Perfil válido encontrado', { 
              profileName: profile.name, 
              accountId: testAccountId,
              inboxId: profile.inbox_id,
              isDefault 
            });
            
            return { 
              accountId: String(testAccountId), 
              inboxId: profile.inbox_id ? String(profile.inbox_id) : '',
              isDefault
            };
          } else {
            console.log('[Auto-Detect] ❌ Perfil', profile.name, '- API retornou status:', response.status);
          }
        } catch (err) {
          console.error('[Auto-Detect] ❌ Erro ao testar perfil', profile.name, ':', err);
        }
      }
      
      console.warn('[Auto-Detect] ⚠️ Nenhum perfil válido encontrado após testar todos');
      return null;
      
    } catch (err: any) {
      console.error('[Auto-Detect] ❌ Erro fatal:', err);
      return null;
    }
  }

  // Detectar perfil manualmente a partir de URL colada
  async function handleDetectFromUrl() {
    if (!urlToDetect.trim()) {
      setStatus('❌ Cole a URL do Chatwoot para detectar');
      return;
    }

    try {
      setStatus('🔍 Detectando perfil a partir da URL...');
      
      // Cria um objeto temporário simulando window.location
      const url = new URL(urlToDetect);
      const pathname = url.pathname || '';
      const search = url.search || '';
      const hash = url.hash || '';
      const origin = url.origin || '';
      
      console.log('[Manual Detect] 🔍 URL fornecida:', urlToDetect);
      console.log('[Manual Detect] 📊 Pathname:', pathname, 'Origin:', origin);
      
      // Extrai account_id, conversation_id usando mesma lógica
      const accMatch = pathname.match(/\/accounts?\/(\d+)/i);
      const convMatch = pathname.match(/\/conversations?\/(\d+)/i);
      const inboxMatch = pathname.match(/\/inbox\/(\d+)/i);
      
      let detectedAccountId = accMatch ? accMatch[1] : null;
      let detectedConvId = convMatch ? convMatch[1] : null;
      let detectedInboxId = inboxMatch ? inboxMatch[1] : null;
      
      // Fallback query/hash
      const qs = new URLSearchParams(search);
      const hs = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
      const get = (keys: string[]) => {
        for (const k of keys) {
          const v = qs.get(k) || hs.get(k);
          if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
        }
        return null;
      };
      
      if (!detectedAccountId) detectedAccountId = get(['acc','account_id','accountId','account']);
      if (!detectedConvId) detectedConvId = get(['conv','conversation_id','conversationId','id']);
      if (!detectedInboxId) detectedInboxId = get(['inbox','inbox_id','inboxId']);
      
      const detectedOrigin = origin || get(['origin','chatwoot_origin']) || '';
      
      console.log('[Manual Detect] ✅ Extraído:', { 
        accountId: detectedAccountId, 
        conversationId: detectedConvId,
        inboxId: detectedInboxId,
        origin: detectedOrigin 
      });
      
      if (!detectedOrigin) {
        setStatus('❌ Não foi possível detectar a origem (URL base) do Chatwoot');
        return;
      }
      
      if (!detectedAccountId) {
        setStatus('❌ Não foi possível detectar o account_id da URL');
        return;
      }
      
      // Atualiza variáveis globais
      const canon = normalizeOrigin(detectedOrigin);
      setOriginCanon(canon);
      localStorage.setItem('cv_origin', canon);
      
      setAccountId(detectedAccountId);
      localStorage.setItem('cv_account_id', detectedAccountId);
      
      if (detectedConvId) {
        setConversationId(detectedConvId);
        localStorage.setItem('cv_conversation_id', detectedConvId);
      }
      if (detectedInboxId) {
        setInboxId(detectedInboxId);
        localStorage.setItem('cv_inbox_id', detectedInboxId);
      }
      
      // Busca perfis no NocoDB
      const result = await autoDetectValidProfile(canon);
      
      if (result) {
        setStatus(`✅ Perfil detectado: Account ${result.accountId}`);
        setShowDetectProfileModal(false);
        setUrlToDetect('');
        
        // Atualiza interface
        setAccountId(result.accountId);
        if (result.inboxId) setInboxId(result.inboxId);
        
        // Recarrega lista de perfis
        await loadProfiles(canon, result.accountId);
      } else {
        setStatus('❌ Nenhum perfil válido encontrado para esta URL');
      }
      
    } catch (err) {
      console.error('[Manual Detect] ❌ Erro:', err);
      setStatus('❌ Erro ao detectar perfil. Verifique a URL.');
    }
  }

  // Verifica se deve mostrar botão de detectar perfil
  const shouldShowDetectButton = profiles.length === 0 && !accountId;

  async function loadProfiles(filterOrigin?: string, filterAccountId?: string) {
    // CRÍTICO: Só carrega perfis se tiver ambos os filtros
    if (!filterOrigin || !filterAccountId) {
      console.warn('[Perfis] ⚠️ Aguardando detecção de origin e accountId da URL...');
      setProfiles([]);
      setProfilesStatus({});
      return;
    }
    
    setLoadingProfiles(true);
    setProfilesError('');
    
    try {
      // Constrói filtro WHERE para buscar apenas perfis deste origin + account_id
      const whereCondition = `(chatwoot_origin,eq,${filterOrigin})~and(account_id,eq,${filterAccountId})`;
      const url = `${NOCO_URL}/api/v2/tables/${NOCO_TABLE_PROFILES_ID}/records?where=${encodeURIComponent(whereCondition)}&limit=1000`;
      
      console.log('[Perfis] 🔍 Consultando perfis FILTRADOS no NocoDB:');
      console.log('[Perfis]   - chatwoot_origin:', filterOrigin);
      console.log('[Perfis]   - account_id:', filterAccountId);
      console.log('[Perfis]   - URL:', url);
      
      const data = await nocoGET(url);
      const list = Array.isArray(data?.list) ? data.list : [];
      
      console.log('[Perfis] ✅ Resposta NocoDB:', list.length, 'perfil(is) encontrado(s)');
      
      const mappedProfiles = list.map((r: any) => ({
        Id: r.Id,
        name: r.name || r.profile_name || 'Perfil',
        evo_base_url: r.evo_base_url || '',
        evo_instance: r.evo_instance || '',
        evo_apikey: r.evo_apikey || '',
        chatwoot_origin: r.chatwoot_origin,
        account_id: r.account_id,
        inbox_id: r.inbox_id,
        admin_apikey: r.admin_apikey || r.adimin_apikey || '',
        default: !!(r.default === true || r.default === 'true' || r.default === 1),
        is_active: !!(r.is_active === true || r.is_active === 'true' || r.is_active === 1),
        item_delay: Number(r.item_delay) || 3,
        item_variance: Number(r.item_variance) || 4,
        contact_delay: Number(r.contact_delay) || 10,
        contact_variance: Number(r.contact_variance) || 10
      }));
      
      // Verifica o status de cada perfil na Evolution API
      const statusMap: Record<string, 'open' | 'close' | 'connecting' | null> = {};
      await Promise.all(
        mappedProfiles.map(async (profile) => {
          try {
            const status = await fetchConnectionStatus(profile);
            statusMap[String(profile.Id)] = status;
            console.log(`[Perfis] Status de ${profile.name}:`, status);
          } catch (e) {
            console.error(`[Perfis] Erro ao verificar status de ${profile.name}:`, e);
            statusMap[String(profile.Id)] = null;
          }
        })
      );
      
      setProfilesStatus(statusMap);
      
      // Ordena perfis: perfil com default=true primeiro, depois por nome
      const sortedProfiles = mappedProfiles.sort((a, b) => {
        if (a.default && !b.default) return -1;
        if (!a.default && b.default) return 1;
        return (a.name || '').localeCompare(b.name || '');
      });
      
      setProfiles(sortedProfiles);
      
      if (sortedProfiles.length > 0) {
        setStatus(`${sortedProfiles.length} perfil(is) carregado(s) para esta conta.`);
        
        // Auto-seleciona o primeiro perfil (preferência para default=true)
        if (!selectedProfileId) {
          setSelectedProfileId(String(sortedProfiles[0].Id));
          console.log('[Perfis] ✅ Auto-selecionado perfil:', sortedProfiles[0].name);
        }
      } else {
        setStatus('⚠️ Nenhum perfil encontrado para esta conta.');
        setProfilesError('Nenhum perfil de conexão configurado para esta conta.');
      }
      
    } catch (err: any) {
      console.error('[Perfis] ❌ Erro ao carregar:', err);
      setProfilesError(err.message || 'Falha ao carregar perfis');
      setStatus('Erro ao carregar perfis.');
    } finally {
      setLoadingProfiles(false);
    }
  }

  // Novo: Auto-detecta perfil válido quando origin é detectado (mas accountId ainda não)
  useEffect(() => {
    if (originCanon && !accountId) {
      console.log('[Auto-Detect] 🚀 Origin detectado, mas accountId ausente. Iniciando auto-detecção...');
      autoDetectValidProfile(originCanon).then(result => {
        if (result) {
          console.log('[Auto-Detect] ✅ Auto-detecção concluída com sucesso');
        } else {
          console.warn('[Auto-Detect] ⚠️ Não foi possível auto-detectar um perfil válido');
        }
      });
    }
  }, [originCanon]);

  useEffect(() => {
    // CRÍTICO: Só carrega perfis DEPOIS de detectar origin e accountId da URL
    if (originCanon && accountId) {
      console.log('[Perfis] 🚀 Iniciando carregamento de perfis com filtros:');
      console.log('[Perfis]   - originCanon:', originCanon);
      console.log('[Perfis]   - accountId:', accountId);
      loadProfiles(originCanon, accountId);
    } else {
      console.log('[Perfis] ⏳ Aguardando detecção completa da URL...');
      console.log('[Perfis]   - originCanon:', originCanon || '❌ não detectado');
      console.log('[Perfis]   - accountId:', accountId || '❌ não detectado');
    }
  }, [originCanon, accountId]);

  // Atualiza configurações quando um perfil é selecionado
  useEffect(() => {
    if (!selectedProfileId || profiles.length === 0) return;
    
    const selectedProfile = profiles.find(p => String(p.Id) === String(selectedProfileId));
    
    if (!selectedProfile) {
      console.warn('[Perfil Selecionado] ⚠️ Perfil não encontrado:', selectedProfileId);
      return;
    }
    
    console.log('[Perfil Selecionado] ✅ Perfil ativo:', selectedProfile.name);
    console.log('[Perfil Selecionado]   - admin_apikey:', selectedProfile.admin_apikey ? '✅ disponível' : '❌ não configurado');
    console.log('[Perfil Selecionado]   - is_active:', selectedProfile.is_active);
    
    // Atualiza tenantConfig com base no perfil selecionado
    const profileConfig: TenantConfig = {
      id: String(selectedProfile.Id),
      chatwoot_origin: selectedProfile.chatwoot_origin,
      account_id: String(selectedProfile.account_id),
      admin_apikey: selectedProfile.admin_apikey,
      is_active: selectedProfile.is_active,
      default: selectedProfile.default,
      cv_activa: false,
      cv_active: false,
      cv_email: '',
      cv_apikey: ''
    };
    
    setTenantConfig(profileConfig);
    setHasChatwootAccess(!!(selectedProfile.admin_apikey && selectedProfile.is_active));
    
    // Expõe variáveis globais do perfil selecionado
    if (typeof window !== 'undefined') {
      (window as any).__ADMIN_APIKEY__ = selectedProfile.admin_apikey || '';
      console.log('[Perfil Selecionado] 🌐 Variável global __ADMIN_APIKEY__ atualizada');
      
      addDebug('profile', 'Perfil selecionado e configurado', {
        name: selectedProfile.name,
        id: selectedProfile.Id,
        has_admin_apikey: !!selectedProfile.admin_apikey,
        is_active: selectedProfile.is_active
      });
    }
    
    // Atualiza delays globais com base no perfil
    setItemDelay(selectedProfile.item_delay);
    setItemVariance(selectedProfile.item_variance);
    setContactDelay(selectedProfile.contact_delay);
    setContactVariance(selectedProfile.contact_variance);
    
    console.log('[Perfil Selecionado] ⏱️ Delays configurados:', {
      itemDelay: selectedProfile.item_delay,
      itemVariance: selectedProfile.item_variance,
      contactDelay: selectedProfile.contact_delay,
      contactVariance: selectedProfile.contact_variance
    });
  }, [selectedProfileId, profiles]);

  // Carrega etiquetas automaticamente quando tiver acesso ao Chatwoot
  useEffect(() => {
    if (hasChatwootAccess && tenantConfig?.admin_apikey && originCanon && accountId) {
      loadLabels();
    }
  }, [hasChatwootAccess, tenantConfig, originCanon, accountId]);

  // Carrega grupos automaticamente quando listMode for 'grupos'
  useEffect(() => {
    if (listMode === 'grupos' && selectedProfileId && profiles.length > 0) {
      loadGrupos();
    }
  }, [listMode, selectedProfileId, profiles]);

  // Carrega empreendimentos automaticamente quando tiver acesso CV
  useEffect(() => {
    console.log('[useEffect:empreendimentos] Verificando condições...', { 
      hasCvAccess, 
      listMode,
      empresasTokensData: empresasTokensData ? '✅' : '❌'
    });
    addDebug('emp', 'useEffect verificação', { 
      hasCvAccess, 
      listMode,
      hasEmpresasData: !!empresasTokensData
    });
    
    if (hasCvAccess && listMode === 'empreendimentos' && empresasTokensData) {
      console.log('[useEffect:empreendimentos] ✅ Condições atendidas, chamando loadEmpreendimentos');
      loadEmpreendimentos();
    } else {
      console.log('[useEffect:empreendimentos] ❌ Condições não atendidas:', {
        hasCvAccess_ok: hasCvAccess ? '✅' : '❌',
        listMode_ok: listMode === 'empreendimentos' ? '✅' : '❌',
        empresasTokensData_ok: empresasTokensData ? '✅' : '❌'
      });
    }
  }, [hasCvAccess, listMode, empresasTokensData]);

  // ========== FUNÇÕES DE CONTATOS ==========
  
  async function handleImportFile(file: File) {
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      
      const imported: Contact[] = [];
      const validContacts: string[] = [];
      const invalidContacts: string[] = [];
      const correctedContacts: string[] = [];
      const duplicates = new Set<string>();
      const existingPhones = new Set(contacts.map(c => stripDigits(c.phone)));
      
      for (const row of rows) {
        const name = String(row['Nome'] || row['nome'] || row['Name'] || row['name'] || '').trim();
        const phoneRaw = String(row['Telefone'] || row['telefone'] || row['Phone'] || row['phone'] || '').trim();
        const tagsRaw = String(row['Tags'] || row['tags'] || row['Etiquetas'] || row['etiquetas'] || '').trim();
        
        // Tratamento de números vazios
        if (!phoneRaw || phoneRaw === '-') {
          const contact: Contact = {
            id: uid(),
            name: name || 'Sem nome',
            phone: phoneRaw || '(vazio)',
            tags: tagsRaw || 'IMPORTADOS',
            srcImported: true,
            validationError: 'Número vazio ou inválido'
          };
          imported.push(contact);
          invalidContacts.push(contact.id);
          continue;
        }
        
        const digits = stripDigits(phoneRaw);
        
        // Tratamento de números sem dígitos
        if (!digits) {
          const contact: Contact = {
            id: uid(),
            name: name || 'Sem nome',
            phone: phoneRaw,
            tags: tagsRaw || 'IMPORTADOS',
            srcImported: true,
            validationError: 'Sem dígitos válidos'
          };
          imported.push(contact);
          invalidContacts.push(contact.id);
          continue;
        }
        
        // Verifica duplicação
        if (existingPhones.has(digits)) {
          duplicates.add(phoneRaw);
          continue;
        }
        
        // Valida e normaliza o número brasileiro
        const validation = validateAndNormalizeBrazilianPhone(phoneRaw, defaultCountryCode);
        
        if (!validation.valid) {
          // Número inválido - adiciona mas não seleciona
          const contact: Contact = {
            id: uid(),
            name: name || 'Sem nome',
            phone: phoneRaw,
            tags: tagsRaw || 'IMPORTADOS',
            srcImported: true,
            validationError: validation.error
          };
          imported.push(contact);
          invalidContacts.push(contact.id);
          existingPhones.add(digits);
          continue;
        }
        
        // Número válido - adiciona e seleciona
        const contact: Contact = {
          id: uid(),
          name: name || 'Sem nome',
          phone: validation.phone,
          tags: tagsRaw || 'IMPORTADOS',
          srcImported: true,
          validationWarning: validation.warning
        };
        
        imported.push(contact);
        validContacts.push(contact.id);
        
        if (validation.warning) {
          correctedContacts.push(contact.id);
        }
        
        existingPhones.add(digits);
      }
      
      // Monta mensagem detalhada
      const messages: string[] = [];
      
      if (validContacts.length > 0) {
        messages.push(`✅ ${validContacts.length} válido(s)`);
      }
      
      if (correctedContacts.length > 0) {
        messages.push(`🔧 ${correctedContacts.length} corrigido(s)`);
      }
      
      if (invalidContacts.length > 0) {
        messages.push(`⚠️ ${invalidContacts.length} inválido(s) (desmarcados)`);
      }
      
      if (duplicates.size > 0) {
        messages.push(`🔄 ${duplicates.size} duplicado(s) ignorado(s)`);
      }
      
      if (imported.length === 0) {
        setStatus('⚠️ Nenhum contato encontrado no arquivo.');
        return;
      }
      
      // Log detalhado no console
      if (invalidContacts.length > 0) {
        console.group('⚠️ Contatos Inválidos (não selecionados):');
        imported
          .filter(c => c.validationError)
          .forEach(c => {
            console.log(`❌ ${c.phone} → ${c.validationError}`);
          });
        console.groupEnd();
      }
      
      if (correctedContacts.length > 0) {
        console.group('🔧 Números Corrigidos Automaticamente:');
        imported
          .filter(c => c.validationWarning)
          .forEach(c => {
            console.log(`✅ ${c.phone} → ${c.validationWarning}`);
          });
        console.groupEnd();
      }
      
      setContacts(prev => [...prev, ...imported]);
      // Seleciona apenas os contatos válidos
      setSelectedContacts(prev => [...prev, ...validContacts]);
      setStatus(messages.join(' | '));
    } catch (e: any) {
      setStatus(`❌ Erro ao importar: ${e.message}`);
    }
  }

  async function loadLabels() {
    if (!hasChatwootAccess || labelsBusy || !tenantConfig?.admin_apikey || !originCanon || !accountId) return;
    
    setLabelsBusy(true);
    setStatus('Consultando etiquetas...');
    
    try {
      if (labelsReqRef.current.controller) labelsReqRef.current.controller.abort();
      labelsReqRef.current.controller = new AbortController();
      
      const result = await fetchLabels(
        tenantConfig.admin_apikey,
        originCanon,
        accountId
      );
      
      setLabels(result);
      setStatus(`${result.length} etiquetas encontradas.`);
      console.log('[loadLabels] Etiquetas carregadas:', result);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('Erro ao carregar etiquetas:', e);
        setStatus(`Erro ao carregar etiquetas: ${e.message}`);
      }
    } finally {
      setLabelsBusy(false);
    }
  }

  async function loadFromLabels() {
    if (!selectedLabelIds.length) {
      setNeedSelectLabelHint(true);
      setTimeout(() => setNeedSelectLabelHint(false), 3000);
      return;
    }
    
    const selectedProfile = profiles.find(p => String(p.Id) === String(selectedProfileId));
    if (!selectedProfile || !originCanon || !accountId) {
      setStatus('❌ Perfil não identificado ou dados incompletos.');
      return;
    }
    
    setLabelsBusy(true);
    setStatus('Carregando contatos das etiquetas...');
    
    try {
      const selectedLabels = labels.filter(l => selectedLabelIds.includes(l.id)).map(l => ({
        id: String(l.id),
        title: l.title
      }));
      
      console.log('[loadFromLabels] Payload enviado:', {
        origin: originCanon,
        accountId: accountId,
        inboxId: selectedProfile.inbox_id?.toString() || '',
        conversationId: '',
        labels: selectedLabels
      });
      
      const users = await fetchUsersByLabels(
        originCanon,
        accountId,
        selectedProfile.inbox_id?.toString() || '',
        '',
        selectedLabels
      );
      
      console.log('[loadFromLabels] Usuários recebidos:', users);
      
      const duplicates = new Set<string>();
      const existingPhones = new Set(contacts.map(c => stripDigits(c.phone)));
      
      const newContacts: Contact[] = users
        .map((u: any) => {
          const digits = stripDigits(u.phone || '');
          if (!digits) return null;
          
          if (existingPhones.has(digits)) {
            duplicates.add(digits);
            return null;
          }
          
          const phone = ensureE164(digits, defaultCountryCode);
          if (!phone) return null;
          
          existingPhones.add(digits);
          
          return {
            id: uid(),
            name: u.name || 'Sem nome',
            phone,
            tags: selectedLabels.map(l => l.title).join(', '),
            srcLabel: true
          };
        })
        .filter((c) => c !== null) as Contact[];
      
      setContacts(prev => [...prev, ...newContacts]);
      setSelectedContacts(prev => [...prev, ...newContacts.map(c => c.id)]);
      setStatus(duplicates.size > 0
        ? `✅ ${newContacts.length} contato(s) carregado(s). ${duplicates.size} duplicado(s) ignorado(s).`
        : `✅ ${newContacts.length} contato(s) carregado(s).`
      );
    } catch (e: any) {
      console.error('[loadFromLabels] Erro:', e);
      setStatus(`❌ Erro ao carregar contatos: ${e.message}`);
    } finally {
      setLabelsBusy(false);
    }
  }

  async function loadGrupos() {
    const selectedProfile = profiles.find(p => String(p.Id) === String(selectedProfileId));
    if (!selectedProfile) {
      setStatus('❌ Perfil não selecionado.');
      return;
    }

    setGroupParticipantsBusy(true);
    setStatus('Consultando grupos...');
    
    try {
      console.log('[loadGrupos] Carregando grupos do perfil:', selectedProfile);
      
      const groupsList = await fetchGroups(selectedProfile);
      
      console.log('[loadGrupos] Grupos recebidos:', groupsList);
      
      // Filtrar por query se houver
      let filtered = groupsList;
      if (groupQuery.trim()) {
        const q = groupQuery.toLowerCase();
        filtered = groupsList.filter(g => 
          g.name.toLowerCase().includes(q)
        );
      }
      
      setGrupos(filtered);
      setStatus(filtered.length > 0 
        ? `✅ ${filtered.length} grupo(s) encontrado(s).` 
        : 'Nenhum grupo encontrado.'
      );
    } catch (e: any) {
      console.error('[loadGrupos] Erro:', e);
      setStatus(`❌ Erro ao carregar grupos: ${e.message}`);
      setGrupos([]);
    } finally {
      setGroupParticipantsBusy(false);
    }
  }

  async function loadFromGroups() {
    if (!selectedGroupIds.length) {
      setNeedSelectGroupHint(true);
      setTimeout(() => setNeedSelectGroupHint(false), 3000);
      return;
    }
    
    const selectedProfile = profiles.find(p => String(p.Id) === String(selectedProfileId));
    if (!selectedProfile) {
      setStatus('❌ Perfil não identificado.');
      return;
    }
    
    setGroupParticipantsBusy(true);
    setStatus('Carregando participantes dos grupos...');
    
    try {
      const selectedGroups = grupos.filter(g => selectedGroupIds.includes(g.id));
      
      console.log('[loadFromGroups] Carregando participantes dos grupos:', selectedGroups);
      
      const users = await fetchGroupParticipants(originCanon, accountId, selectedProfile, selectedGroups);
      
      console.log('[loadFromGroups] Participantes recebidos:', users);
      
      if (!users.length) {
        setLastParticipantsEmpty(true);
        setTimeout(() => setLastParticipantsEmpty(false), 4000);
        setStatus('Nenhum participante encontrado nos grupos selecionados.');
        return;
      }
      
      const duplicates = new Set<string>();
      const existingPhones = new Set(contacts.map(c => stripDigits(c.phone)));
      
      const newContacts: Contact[] = users
        .map((u: any) => {
          const digits = stripDigits(u.phone || '');
          if (!digits) return null;
          
          if (existingPhones.has(digits)) {
            duplicates.add(digits);
            return null;
          }
          
          const phone = ensureE164(digits, defaultCountryCode);
          if (!phone) return null;
          
          existingPhones.add(digits);
          
          return {
            id: uid(),
            name: u.name || 'Sem nome',
            phone,
            tags: selectedGroups.map(g => g.name).join(', '),
            srcGroup: true
          };
        })
        .filter((c) => c !== null) as Contact[];
      
      setContacts(prev => [...prev, ...newContacts]);
      setSelectedContacts(prev => [...prev, ...newContacts.map(c => c.id)]);
      setStatus(duplicates.size > 0
        ? `✅ ${newContacts.length} participante(s) carregado(s). ${duplicates.size} duplicado(s) ignorado(s).`
        : `✅ ${newContacts.length} participante(s) carregado(s).`
      );
    } catch (e: any) {
      console.error('[loadFromGroups] Erro:', e);
      setStatus(`❌ Erro ao carregar participantes: ${e.message}`);
    } finally {
      setGroupParticipantsBusy(false);
    }
  }

  async function loadEmpreendimentos() {
    console.log('[loadEmpreendimentos] Iniciando...', { hasCvAccess, listMode });
    
    if (!hasCvAccess) {
      console.log('[loadEmpreendimentos] ❌ Acesso CV negado ou não disponível');
      setStatus('❌ Acesso ao CV não disponível. Verifique as configurações.');
      return;
    }
    
    if (empsBusy) {
      console.log('[loadEmpreendimentos] Já está carregando...');
      return;
    }
    
    if (!empresasTokensData || !empresasTokensData.cv_url || !empresasTokensData.cv_email || !empresasTokensData.cv_apikey) {
      console.log('[loadEmpreendimentos] ❌ Dados de EMPRESAS_TOKENS não disponíveis');
      setStatus('❌ Credenciais CV não encontradas. Verifique a tabela EMPRESAS_TOKENS.');
      return;
    }
    
    setEmpsBusy(true);
    setStatus('Carregando empreendimentos...');
    
    try {
      console.log('[loadEmpreendimentos] ✅ Iniciando requisição para:', empresasTokensData.cv_url);
      
      const list = await fetchEmpreendimentos(
        empresasTokensData.cv_url,
        empresasTokensData.cv_email,
        empresasTokensData.cv_apikey
      );
      
      console.log('[loadEmpreendimentos] ✅ Resposta recebida:', { count: list.length });
      
      setEmpreendimentos(list);
      setStatus(list.length > 0 
        ? `✅ ${list.length} empreendimento(s) encontrado(s).` 
        : 'Nenhum empreendimento encontrado.'
      );
    } catch (e: any) {
      console.error('[loadEmpreendimentos] ❌ Erro:', e);
      setStatus(`❌ Erro ao carregar empreendimentos: ${e.message}`);
      setEmpreendimentos([]);
    } finally {
      setEmpsBusy(false);
      console.log('[loadEmpreendimentos] Finalizado');
    }
  }

  async function loadFromEmps() {
    console.log('[loadFromEmps] Iniciando...', {
      selectedEmpIds: selectedEmpIds.length,
      selectedProfileId
    });
    
    if (!selectedEmpIds.length) {
      console.log('[loadFromEmps] ❌ Nenhum empreendimento selecionado');
      setStatus('❌ Selecione ao menos um empreendimento');
      return;
    }
    
    const selectedProfile = profiles.find(p => String(p.Id) === String(selectedProfileId));
    console.log('[loadFromEmps] Perfil encontrado:', selectedProfile ? '✅' : '❌');
    
    if (!selectedProfile || !originCanon || !accountId) {
      console.log('[loadFromEmps] ❌ Dados incompletos');
      setStatus('❌ Perfil não identificado ou dados incompletos.');
      return;
    }
    
    setEmpsBusy(true);
    setStatus('Carregando contatos dos empreendimentos...');
    
    try {
      const selectedEmps = empreendimentos
        .filter(e => selectedEmpIds.includes(e.id))
        .map(e => ({
          id: String(e.id),
          nome: e.name || e.title || String(e.id)
        }));
      
      const payload = {
        origin: originCanon,
        accountId: accountId,
        inboxId: selectedProfile.inbox_id?.toString() || '',
        conversationId: conversationId || '',
        empreendimentos: selectedEmps
      };
      
      console.log('[loadFromEmps] ✅ Payload completo:', payload);
      addDebug('emp', 'Requisição de usuários por empreendimentos', {
        url: WEBHOOK_LIST_ENTS,
        payload_completo: payload
      });
      
      const users = await fetchUsersByEmpreendimentos(
        originCanon,
        accountId,
        selectedProfile.inbox_id?.toString() || '',
        conversationId || '',
        selectedEmps
      );
      
      console.log('[loadFromEmps] ✅ Resposta recebida:', { count: users.length, users });
      addDebug('emp', 'Usuários recebidos por empreendimentos', { 
        count: users.length, 
        sample: users.slice(0, 5),
        todos: users
      });
      
      const duplicates = new Set<string>();
      const existingPhones = new Set(contacts.map(c => stripDigits(c.phone)));
      
      const newContacts: Contact[] = users
        .map((u: any) => {
          const digits = stripDigits(u.phone || '');
          if (!digits) return null;
          
          if (existingPhones.has(digits)) {
            duplicates.add(digits);
            return null;
          }
          
          const phone = ensureE164(digits, defaultCountryCode);
          if (!phone) return null;
          
          existingPhones.add(digits);
          
          return {
            id: uid(),
            name: u.name || 'Sem nome',
            phone,
            tags: selectedEmps.map(e => e.nome).join(', '),
            srcEmp: true
          };
        })
        .filter((c) => c !== null) as Contact[];
      
      setContacts(prev => [...prev, ...newContacts]);
      setSelectedContacts(prev => [...prev, ...newContacts.map(c => c.id)]);
      setStatus(duplicates.size > 0
        ? `✅ ${newContacts.length} contato(s) carregado(s). ${duplicates.size} duplicado(s) ignorado(s).`
        : `✅ ${newContacts.length} contato(s) carregado(s).`
      );
    } catch (e: any) {
      console.error('[loadFromEmps] Erro:', e);
      addDebug('emp', 'Erro ao carregar usuários por empreendimentos', { error: String(e) });
      setStatus(`❌ Erro ao carregar contatos: ${e.message}`);
    } finally {
      setEmpsBusy(false);
    }
  }

  function removeContact(id: string) {
    setDeleteConfirm({
      show: true,
      type: 'contact',
      id,
      callback: () => {
        setContacts(prev => prev.filter(c => c.id !== id));
        setSelectedContacts(prev => prev.filter(cid => cid !== id));
        setDeleteConfirm({ show: false, type: '' });
      }
    });
  }

  function clearAllContacts() {
    setDeleteConfirm({
      show: true,
      type: 'all-contacts',
      callback: () => {
        setContacts([]);
        setSelectedContacts([]);
        // Resetar input file
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        setDeleteConfirm({ show: false, type: '' });
      }
    });
  }

  function clearBySource(source: 'importados' | 'etiquetas' | 'grupos' | 'empreendimentos') {
    const predicate = (c: Contact) => {
      const t = (c.tags || '').toUpperCase();
      if (source === 'importados') return !!c.srcImported || t.includes('IMPORT');
      if (source === 'etiquetas') return !!c.srcLabel || t.includes('ETIQUET');
      if (source === 'grupos') return !!c.srcGroup || t.includes('GRUPO');
      if (source === 'empreendimentos') return !!c.srcEmp || t.includes('EMPREEND');
      return false;
    };

    setDeleteConfirm({
      show: true,
      type: 'clear-source',
      callback: () => {
        setContacts(prev => prev.filter(c => !predicate(c)));
        setSelectedContacts(prev => prev.filter(id => {
          const c = contacts.find(cc => cc.id === id);
          return c ? !predicate(c) : true;
        }));
        // Resetar input file se limpar importados
        if (source === 'importados' && fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        setDeleteConfirm({ show: false, type: '' });
      }
    });
  }

  function toggleSelectAll() {
    if (selectedContacts.length === visibleContacts.length) {
      setSelectedContacts([]);
    } else {
      setSelectedContacts(visibleContacts.map(c => c.id));
    }
  }

  function toggleContact(id: string) {
    setSelectedContacts(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  // ========== FUNÇÕES DE BLOCOS ==========

  // Função helper para jitter (delay randômico)
  function jitter(base: number, variance: number): number {
    const v = Math.max(0, Number(variance) || 0);
    const b = Math.max(0, Number(base) || 0);
    if (!v) return b;
    const min = Math.max(0, b - v);
    const max = b + v;
    return Math.round(min + Math.random() * (max - min));
  }

  function addBlock(type: string) {
    const delay = jitter(itemDelay, itemVariance); // Delay randômico para cada bloco
    const newBlock: Block = {
      id: uid(),
      type: type as any,
      action: 'sendMessage',
      data: defaultsByType(type),
      itemWait: delay
    };
    setBlocks(prev => [...prev, newBlock]);
  }

  async function removeBlock(id: string) {
    // Busca o bloco para excluir o arquivo do Supabase se existir
    const block = blocks.find(b => b.id === id);
    if (block?.data?._supaPath) {
      try {
        await supaRemove(block.data._supaPath);
        console.log('[removeBlock] Arquivo removido do Supabase:', block.data._supaPath);
      } catch (e) {
        console.error('[removeBlock] Erro ao remover arquivo do Supabase:', e);
      }
    }
    setBlocks(prev => prev.filter(b => b.id !== id));
  }

  function updateBlockData(id: string, newData: any) {
    setBlocks(prev => prev.map(b => (b.id === id ? { ...b, data: { ...b.data, ...newData } } : b)));
  }

  function moveBlockUp(id: string) {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id);
      if (idx <= 0) return prev;
      const arr = [...prev];
      [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
      return arr;
    });
  }

  function moveBlockDown(id: string) {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const arr = [...prev];
      [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
      return arr;
    });
  }

  function duplicateBlock(id: string) {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id);
      if (idx < 0) return prev;
      const original = prev[idx];
      const copy: Block = {
        ...original,
        id: uid(),
        data: { ...original.data }
      };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  }

  // ========== FUNÇÕES DE ENVIO ==========

  async function handleSend() {
    // Validações
    if (!tenantConfig || !tenantConfig.admin_apikey) {
      setStatus('❌ Erro: Configuração do tenant não encontrada. Verifique se o admin_apikey está definido.');
      return;
    }
    if (!accountId || !originCanon) {
      console.error('[handleSend] ❌ CRÍTICO: Dados da URL não detectados!');
      console.error('[handleSend]   - accountId:', accountId || '❌ NÃO DETECTADO');
      console.error('[handleSend]   - originCanon:', originCanon || '❌ NÃO DETECTADO');
      setStatus('❌ Erro: dados da URL (accountId ou origin) não foram detectados. Recarregue a página.');
      return;
    }
    if (!selectedProfileId) {
      setStatus('❌ Selecione um perfil antes de enviar.');
      return;
    }
    if (!selectedContacts.length) {
      setStatus('❌ Selecione ao menos um contato.');
      return;
    }
    if (!blocks.length) {
      setStatus('❌ Adicione ao menos um bloco de mensagem.');
      return;
    }

    const selectedProfile = profiles.find(p => String(p.Id) === String(selectedProfileId));
    if (!selectedProfile) {
      setStatus('❌ Perfil não encontrado.');
      return;
    }

    // Verifica se o perfil está ativo
    if (!selectedProfile.is_active) {
      setStatus('❌ Perfil não está ativo.');
      return;
    }

    // Verifica se tem os dados necessários do Evolution
    if (!selectedProfile.evo_base_url) {
      setStatus('❌ Perfil sem URL de origem (evo_base_url). Verifique a configuração no NocoDB.');
      console.error('[handleSend] Perfil sem evo_base_url:', selectedProfile);
      return;
    }

    if (!selectedProfile.evo_instance) {
      setStatus('❌ Perfil sem instância configurada (evo_instance).');
      console.error('[handleSend] Perfil sem evo_instance:', selectedProfile);
      return;
    }

    if (!selectedProfile.evo_apikey) {
      setStatus('❌ Perfil sem token configurado (evo_apikey).');
      console.error('[handleSend] Perfil sem evo_apikey:', selectedProfile);
      return;
    }

    setSending(true);
    try {
      const contactsToSend = contacts.filter(c => selectedContacts.includes(c.id));
      
      const runId = `run_${Date.now()}_${uid()}`;
      
      // Converte o datetime-local para UTC se houver agendamento
      let whenUTC: string;
      if (schedule) {
        // datetime-local retorna formato "YYYY-MM-DDTHH:mm", assumindo fuso local
        const localDate = new Date(schedule);
        whenUTC = localDate.toISOString();
      } else {
        whenUTC = new Date().toISOString();
      }
      
      // Formata contatos
      const shuffledContacts = contactsToSend.map(c => ({
        name: c.name,
        phone: c.phone,
        srcImported: !!c.srcImported,
        srcLabel: !!c.srcLabel,
        tags: c.tags || '—'
      }));

      // Formata blocos
      const blocksForPayload = blocks.map(b => ({
        type: b.type,
        action: normalizeAction(b.action),
        data: b.data,
        itemWait: b.itemWait
      }));

      // Payload JSON interno (usado pelo servidor)
      const payload_json = {
        randomize: true,
        seed: runId,
        delays: {
          itemDelay: itemDelay,
          itemVariance: itemVariance,
          contactDelay: contactDelay,
          contactVariance: contactVariance
        },
        profile: {
          evo_base_url: selectedProfile.evo_base_url,
          evo_instance: selectedProfile.evo_instance,
          evo_token: selectedProfile.evo_apikey
        },
        blocks: blocksForPayload,
        contacts: shuffledContacts
      };

      // Record que será salvo no NocoDB
      const record = {
        run_id: runId,
        account_id: Number(accountId || 0),
        inbox_id: Number(selectedProfile.inbox_id || inboxId || 0),
        chatwoot_origin: originCanon,
        name: campaignName || 'Campanha',
        status: 'scheduled',
        is_paused: false,
        scheduled_for: whenUTC,
        contacts_count: shuffledContacts.length,
        items_count: blocks.length,
        progress_contact_ix: 0,
        progress_item_ix: 0,
        payload_json
      };

      console.log('[handleSend] Perfil selecionado:', selectedProfile);
      console.log('[handleSend] Record completo:', record);

      const result = await queueCreate(record);
      console.log('[handleSend] Resultado:', result);
      
      setStatus(`✅ Campanha "${campaignName}" criada com sucesso! ID: ${result.Id || result.id}`);
      
      // Limpa TODOS os campos após sucesso
      setBlocks([]);
      setContacts([]);
      setSelectedContacts([]);
      setSchedule('');
      setCampaignName('Campanha');
      setSelectedProfileId('');
      setEditingQueueId(null);
      setEditMode('none');
      
      // Vai para aba de acompanhar envios
      setCurrentTab('acompanhar');
      setTab('monitor');
      loadMonitor();
    } catch (e: any) {
      console.error('[handleSend] Erro:', e);
      setStatus(`❌ Erro ao criar campanha: ${e.message}`);
    } finally {
      setSending(false);
    }
  }

  function handleCancelEditClone() {
    // Resetar todos os campos e voltar ao monitor
    setBlocks([]);
    setContacts([]);
    setSelectedContacts([]);
    setSchedule('');
    setCampaignName('Campanha');
    setSelectedProfileId('');
    setEditingQueueId(null);
    setEditMode('none');
    setCurrentTab('acompanhar');
    setTab('monitor');
    setStatus('Edição/clone cancelado.');
  }

  // ========== FUNÇÕES DO MONITOR ==========

  async function loadMonitor() {
    if (!accountId || !originCanon) {
      console.log('[Monitor] ❌ Aguardando detecção completa da URL:', { 
        accountId: accountId || '❌ NÃO DETECTADO', 
        originCanon: originCanon || '❌ NÃO DETECTADO' 
      });
      return;
    }
    
    setMonitorBusy(true);
    try {
      // BUSCA PRECISA: Sempre com account_id AND chatwoot_origin AND profile_id
      let where = `(account_id,eq,${accountId})~and(chatwoot_origin,eq,${originCanon})`;
      
      // Filtrar por perfil de envio selecionado
      if (selectedProfileId) {
        where += `~and(profile_id,eq,${selectedProfileId})`;
      }
      
      const offset = (page - 1) * pageSize;
      const sortField = queueSort.field === 'Id' ? 'Id' : queueSort.field;
      const sortDir = queueSort.dir === 'desc' ? '-' : '';
      const sort = queueSort.dir === 'normal' ? '' : `&sort=${sortDir}${sortField}`;
      
      // USA A TABELA CORRETA: TABLE_SEND_QUEUE_ID
      const url = `${NOCO_URL}/api/v2/tables/${TABLE_SEND_QUEUE_ID}/records?where=${encodeURIComponent(where)}&offset=${offset}&limit=${pageSize}${sort}`;
      
      console.log('[Monitor] 🔍 Consultando campanhas com filtros precisos:');
      console.log('[Monitor]   - accountId:', accountId);
      console.log('[Monitor]   - originCanon:', originCanon);
      console.log('[Monitor]   - selectedProfileId:', selectedProfileId || 'TODOS');
      console.log('[Monitor]   - URL:', url);
      
      const data = await nocoGET(url);
      
      console.log('[Monitor] ✅ Resposta NocoDB:', { total: data?.pageInfo?.totalRows, registros: data?.list?.length });
      
      const list = Array.isArray(data?.list) ? data.list : [];
      setQueueRows(list.map((r: any) => ({
        Id: r.Id,
        name: r.name || 'Sem nome',
        status: r.status || 'pending',
        scheduled_for: r.scheduled_for,
        items_count: r.items_count || 0,
        contacts_count: r.contacts_count || 0,
        progress_contact_ix: r.progress_contact_ix,
        run_id: r.run_id,
        is_paused: r.is_paused,
        account_id: r.account_id,
        chatwoot_origin: r.chatwoot_origin
      })));
      
      setTotalRows(data?.pageInfo?.totalRows || 0);
    } catch (e: any) {
      console.error('[Monitor] ❌ Erro ao carregar:', e);
    } finally {
      setMonitorBusy(false);
    }
  }

  useEffect(() => {
    if (tab === 'monitor' && accountId && originCanon) {
      loadMonitor();
    }
  }, [tab, page, queueSort, accountId, originCanon, selectedProfileId]);

  // Atualização automática do monitor (intervalo)
  useEffect(() => {
    if (tab !== 'monitor' || !accountId || !originCanon) return;
    const id = setInterval(() => {
      loadMonitor();
    }, 5000);
    return () => clearInterval(id);
  }, [tab, accountId, originCanon]);

  async function handleDeleteQueue(queueId: string | number) {
    setDeleteConfirm({
      show: true,
      type: 'campaign',
      callback: async () => {
        try {
          await queueDelete(queueId);
          setStatus('Campanha excluída.');
          loadMonitor();
          setDeleteConfirm({ show: false, type: '' });
        } catch (e: any) {
          setStatus(`Erro ao excluir: ${e.message}`);
          setDeleteConfirm({ show: false, type: '' });
        }
      }
    });
  }

  async function handlePauseQueue(queueId: string | number) {
    try {
      await queuePatch(queueId, { is_paused: true, status: 'paused' });
      setStatus('Campanha pausada.');
      loadMonitor();
    } catch (e: any) {
      setStatus(`Erro: ${e.message}`);
    }
  }

  async function handleResumeQueue(queueId: string | number) {
    try {
      // Volta para 'queued' para o worker pegar novamente e continuar de onde parou
      await queuePatch(queueId, { is_paused: false, status: 'queued' });
      setStatus('Campanha retomada. Ela continuará de onde parou.');
      loadMonitor();
    } catch (e: any) {
      setStatus(`Erro: ${e.message}`);
    }
  }

  async function handleDownloadExcel(queueId: string | number, queueName: string, runId: string) {
    try {
      setStatus('Baixando relatório...');
      
      // Buscar logs desta campanha
      const logsData = await logsListForRun(runId);
      const logs = Array.isArray(logsData?.list) ? logsData.list : [];
      
      if (logs.length === 0) {
        setStatus('Nenhum log encontrado para esta campanha.');
        return;
      }
      
      // Contar sucessos e falhas
      const totalLogs = logs.length;
      const sucessos = logs.filter((log: any) => 
        log.level === 'success' || log.level === 'info' || log.http_status === 200 || log.http_status === 201
      ).length;
      const falhas = totalLogs - sucessos;
      
      // Preparar dados para Excel com Numero, Status e Motivo
      const excelData = logs.map((log: any) => {
        const numero = extractNumberFromLog(log);
        const isSuccess = log.level === 'success' || log.level === 'info' || log.http_status === 200 || log.http_status === 201;
        const status = isSuccess ? 'Sucesso' : 'Falha';
        const motivo = !isSuccess ? extractReasonFromLog(log) : '';
        
        return {
          Numero: numero ? formatPhoneLocal(numero) : '-',
          Status: status,
          Motivo: motivo || ''
        };
      });
      
      // Criar planilha
      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Logs');
      
      // Download
      const fileName = `Campanha_logs_${queueName.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;
      XLSX.writeFile(wb, fileName);
      
      setStatus(`✅ Relatório baixado: ${fileName} | Total: ${totalLogs} | Sucessos: ${sucessos} | Falhas: ${falhas}`);
    } catch (e: any) {
      console.error('[handleDownloadExcel] Erro:', e);
      setStatus(`❌ Erro ao baixar relatório: ${e.message}`);
    }
  }

  async function handleCloneQueue(queueId: string | number) {
    try {
      const data = await queueGetOne(queueId);
      if (!data) return;
      
      // Carregar perfil se disponível
      if (data.payload_json?.profile) {
        const profile = profiles.find(p => 
          p.evo_base_url === data.payload_json.profile.evo_base_url &&
          p.evo_instance === data.payload_json.profile.evo_instance
        );
        if (profile) {
          setSelectedProfileId(String(profile.Id));
        }
      }
      
      // Carregar nome da campanha
      setCampaignName(data.name + ' (cópia)');
      setSchedule('');
      
      // Carregar contatos completos do payload_json
      const contactsList = data.payload_json?.contacts || [];
      const importedContacts: Contact[] = contactsList.map((c: any) => ({
        id: uid(),
        name: c.name || 'Sem nome',
        phone: c.phone || '',
        tags: c.tags || '',
        srcImported: c.srcImported,
        srcLabel: c.srcLabel,
        srcGroup: c.srcGroup,
        srcEmp: c.srcEmp
      }));
      
      setContacts(importedContacts);
      setSelectedContacts(importedContacts.map(c => c.id));
      
      // Carregar blocos completos do payload_json
      const blocksList = data.payload_json?.blocks || [];
      const importedBlocks: Block[] = blocksList.map((b: any) => ({
        id: uid(),
        type: b.type,
        action: b.action || 'sendMessage',
        data: b.data || {},
        itemWait: b.itemWait || 0
      }));
      
      setBlocks(importedBlocks);
      
      // Carregar delays do payload_json
      if (data.payload_json?.delays) {
        setItemDelay(data.payload_json.delays.itemDelay || 3);
        setItemVariance(data.payload_json.delays.itemVariance || 4);
        setContactDelay(data.payload_json.delays.contactDelay || 10);
        setContactVariance(data.payload_json.delays.contactVariance || 10);
      }
      
      // Limpar ID de edição e marcar modo
      setEditingQueueId(null);
      setEditMode('clone');
      
      // Mudar para aba de criar campanha
      setCurrentTab('criar');
      setTab('direct');
      setStatus('Campanha clonada! Faça as alterações desejadas.');
    } catch (e: any) {
      setStatus(`Erro ao clonar: ${e.message}`);
    }
  }

  async function handleResendPending(queueId: string | number) {
    try {
      setStatus('Preparando reenvio...');
      
      const data = await queueGetOne(queueId);
      if (!data) {
        setStatus('Erro: Campanha não encontrada.');
        return;
      }
      
      // Buscar logs da campanha
      const logsData = await logsListForRun(data.run_id);
      const logs = Array.isArray(logsData?.list) ? logsData.list : [];
      
      // Identificar números enviados com sucesso
      const successNumbers = new Set<string>();
      const errorNumbers = new Set<string>();
      
      logs.forEach((log: any) => {
        const numero = extractNumberFromLog(log);
        if (!numero) return;
        
        const isSuccess = log.level === 'success' || log.level === 'info' || log.http_status === 200 || log.http_status === 201;
        
        if (isSuccess) {
          successNumbers.add(stripDigits(numero));
        } else {
          errorNumbers.add(stripDigits(numero));
        }
      });
      
      // Carregar perfil se disponível
      if (data.payload_json?.profile) {
        const profile = profiles.find(p => 
          p.evo_base_url === data.payload_json.profile.evo_base_url &&
          p.evo_instance === data.payload_json.profile.evo_instance
        );
        if (profile) {
          setSelectedProfileId(String(profile.Id));
        }
      }
      
      // Nome da campanha com numeração automática de reenvio
      let newCampaignName = data.name;
      const reenvioMatch = data.name.match(/^(.+?)\s*-\s*Reenvio\s+(\d+)$/i);
      
      if (reenvioMatch) {
        // Já é um reenvio, incrementa o número
        const baseName = reenvioMatch[1];
        const currentNumber = parseInt(reenvioMatch[2], 10);
        newCampaignName = `${baseName} - Reenvio ${currentNumber + 1}`;
      } else {
        // Primeira vez que está sendo reenviado
        newCampaignName = `${data.name} - Reenvio 1`;
      }
      
      setCampaignName(newCampaignName);
      setSchedule('');
      
      // Carregar contatos
      const contactsList = data.payload_json?.contacts || [];
      const allContacts: Contact[] = [];
      const selectedIds: string[] = [];
      
      contactsList.forEach((c: any) => {
        const phoneDigits = stripDigits(c.phone || '');
        
        // Remove completamente os que já foram enviados com sucesso
        if (successNumbers.has(phoneDigits)) {
          return; // Não adiciona na lista
        }
        
        // VALIDA o número (aplicando todas as regras)
        const validation = validateAndNormalizeBrazilianPhone(c.phone || '', defaultCountryCode);
        
        const newContact: Contact = {
          id: uid(),
          name: c.name || 'Sem nome',
          phone: validation.valid ? validation.phone : c.phone, // Usa validado se válido
          tags: c.tags || '',
          srcImported: c.srcImported,
          srcLabel: c.srcLabel,
          srcGroup: c.srcGroup,
          srcEmp: c.srcEmp,
          validationError: validation.valid ? undefined : validation.error,
          validationWarning: validation.valid ? validation.warning : undefined
        };
        
        allContacts.push(newContact);
        
        // Seleciona APENAS números VÁLIDOS que NÃO falharam no envio anterior
        // Regra: pendentes válidos = selecionados; erros anteriores = desmarcados; inválidos = desmarcados
        const isValid = validation.valid;
        const inError = errorNumbers.has(phoneDigits);
        
        if (isValid && !inError) {
          selectedIds.push(newContact.id);
        }
      });
      
      setContacts(allContacts);
      setSelectedContacts(selectedIds);
      
      // Carregar blocos
      const blocksList = data.payload_json?.blocks || [];
      const importedBlocks: Block[] = blocksList.map((b: any) => ({
        id: uid(),
        type: b.type,
        action: b.action || 'sendMessage',
        data: b.data || {},
        itemWait: b.itemWait || 0
      }));
      
      setBlocks(importedBlocks);
      
      // Carregar delays
      if (data.payload_json?.delays) {
        setItemDelay(data.payload_json.delays.itemDelay || 3);
        setItemVariance(data.payload_json.delays.itemVariance || 4);
        setContactDelay(data.payload_json.delays.contactDelay || 10);
        setContactVariance(data.payload_json.delays.contactVariance || 10);
      }
      
      // Criar e executar imediatamente
      setEditingQueueId(null);
      setEditMode('none');
      
      // Mudar para aba de criar e enviar automaticamente
      setCurrentTab('criar');
      setTab('direct');
      
      // Fechar popup
      setResendConfirm({ show: false, queueId: null, queueName: '' });
      
      // Aguardar um momento para o estado atualizar e enviar
      setTimeout(() => {
        handleSend();
      }, 500);
      
      const stats = {
        total: contactsList.length,
        removidos: successNumbers.size,
        pendentes: selectedIds.length,
        comErro: allContacts.length - selectedIds.length
      };
      
      setStatus(`✅ Reenvio preparado: ${stats.pendentes} selecionados, ${stats.comErro} desmarcados, ${stats.removidos} sucessos removidos`);
    } catch (e: any) {
      console.error('[handleResendPending] Erro:', e);
      setStatus(`❌ Erro ao preparar reenvio: ${e.message}`);
      setResendConfirm({ show: false, queueId: null, queueName: '' });
    }
  }

  async function handleEditQueue(queueId: string | number) {
    try {
      const data = await queueGetOne(queueId);
      if (!data) return;
      
      // Carregar perfil se disponível
      if (data.payload_json?.profile) {
        const profile = profiles.find(p => 
          p.evo_base_url === data.payload_json.profile.evo_base_url &&
          p.evo_instance === data.payload_json.profile.evo_instance
        );
        if (profile) {
          setSelectedProfileId(String(profile.Id));
        }
      }
      
      // Carregar nome da campanha
      setCampaignName(data.name);
      
      // Carregar agendamento
      if (data.scheduled_for) {
        const dt = new Date(data.scheduled_for);
        const localISO = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString();
        setSchedule(localISO.substring(0, 16));
      } else {
        setSchedule('');
      }
      
      // Carregar contatos completos do payload_json
      const contactsList = data.payload_json?.contacts || [];
      const importedContacts: Contact[] = contactsList.map((c: any) => ({
        id: uid(),
        name: c.name || 'Sem nome',
        phone: c.phone || '',
        tags: c.tags || '',
        srcImported: c.srcImported,
        srcLabel: c.srcLabel,
        srcGroup: c.srcGroup,
        srcEmp: c.srcEmp
      }));
      
      setContacts(importedContacts);
      setSelectedContacts(importedContacts.map(c => c.id));
      
      // Carregar blocos completos do payload_json
      const blocksList = data.payload_json?.blocks || [];
      const importedBlocks: Block[] = blocksList.map((b: any) => ({
        id: uid(),
        type: b.type,
        action: b.action || 'sendMessage',
        data: b.data || {},
        itemWait: b.itemWait || 0
      }));
      
      setBlocks(importedBlocks);
      
      // Carregar delays do payload_json
      if (data.payload_json?.delays) {
        setItemDelay(data.payload_json.delays.itemDelay || 3);
        setItemVariance(data.payload_json.delays.itemVariance || 4);
        setContactDelay(data.payload_json.delays.contactDelay || 10);
        setContactVariance(data.payload_json.delays.contactVariance || 10);
      }
      
      // Guardar ID para atualização e marcar modo
      setEditingQueueId(queueId);
      setEditMode('edit');
      
      // Mudar para aba de criar campanha
      setCurrentTab('criar');
      setTab('direct');
      setStatus('Editando campanha. Faça as alterações e clique em Enviar para salvar.');
    } catch (e: any) {
      setStatus(`Erro ao editar: ${e.message}`);
    }
  }

  async function handleCancelQueue(queueId: string | number) {
    try {
      await queuePatch(queueId, { status: 'cancelled' });
      setStatus('Campanha cancelada.');
      loadMonitor();
    } catch (e: any) {
      setStatus(`Erro ao cancelar: ${e.message}`);
    }
  }

  // ========== VALIDAÇÃO ==========
  
  const isFormValid = useMemo(() => {
    return !!(
      selectedProfileId &&
      selectedContacts.length > 0 &&
      blocks.length > 0 &&
      tenantConfig &&
      tenantConfig.admin_apikey
    );
  }, [selectedProfileId, selectedContacts, blocks, tenantConfig]);

  // ========== FILTROS E ORDENAÇÃO ==========

  const visibleContacts = useMemo(() => {
    let filtered = [...contacts];
    
    if (contactQuery) {
      const q = contactQuery.toLowerCase();
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.tags.toLowerCase().includes(q)
      );
    }

    if (contactSort.dir !== 'normal') {
      filtered.sort((a, b) => {
        let aVal: any = a.name;
        let bVal: any = b.name;
        
        if (contactSort.field === 'phone') {
          aVal = a.phone;
          bVal = b.phone;
        } else if (contactSort.field === 'checkbox') {
          aVal = selectedContacts.includes(a.id) ? 1 : 0;
          bVal = selectedContacts.includes(b.id) ? 1 : 0;
        }
        
        if (aVal < bVal) return contactSort.dir === 'asc' ? -1 : 1;
        if (aVal > bVal) return contactSort.dir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    const start = (contactsPage - 1) * 20;
    return filtered.slice(start, start + 20);
  }, [contacts, selectedContacts, contactQuery, contactSort, contactsPage]);

  const totalContactsPages = Math.ceil(contacts.filter(c => {
    if (!contactQuery) return true;
    const q = contactQuery.toLowerCase();
    return c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      c.tags.toLowerCase().includes(q);
  }).length / 20);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-6">
        <div className="card-custom p-6 md:p-8">
          {/* Header com botão Detectar Perfil */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-foreground">Envio em Massa</h1>
              <p className="text-sm text-muted-foreground">
                Fluxo: perfil → etiquetas/contatos → <b>composição por blocos</b> → <b>upload</b> → <b>agendar</b> e acompanhar.
              </p>
            </div>
            
            {shouldShowDetectButton && (
              <SmallBtn 
                variant="primary" 
                onClick={() => setShowDetectProfileModal(true)}
                title="Detectar perfil automaticamente a partir de URL"
              >
                🔍 Detectar Perfil
              </SmallBtn>
            )}
          </div>

          
          {/* Tabs */}
          <div className="flex gap-1 mb-6 border-b border-border">
            <button
              className={`tab-custom ${tab === 'direct' ? 'tab-custom-active' : 'tab-custom-inactive'}`}
              onClick={() => setTab('direct')}
            >
              Criar campanha
            </button>
            <button
              className={`tab-custom ${tab === 'monitor' ? 'tab-custom-active' : 'tab-custom-inactive'}`}
              onClick={() => setTab('monitor')}
            >
              Acompanhar envios
            </button>
          </div>

          {/* TAB: DIRETO */}
          {tab === 'direct' && (
            <div className="space-y-8">
              {/* Perfil */}
              <div>
                <SectionTitle>Perfil</SectionTitle>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <Field label="Perfil (obrigatório)">
                    <select
                      className="input-custom"
                      value={selectedProfileId}
                      onChange={(e) => setSelectedProfileId(e.target.value)}
                      disabled={loadingProfiles}
                    >
                      <option value="">Selecione um perfil</option>
                      {profiles.map((p) => {
                        const status = profilesStatus[String(p.Id)];
                        const statusText = status === 'open' ? '🟢 ON' : status === 'close' ? '🔴 OFF' : status === 'connecting' ? '🟡 CONECTANDO' : '⚪ OFF';
                        const displayText = `${p.name} — ${p.evo_instance} • ${statusText}`;
                        return (
                          <option key={p.Id} value={p.Id}>
                            {displayText}
                          </option>
                        );
                      })}
                    </select>
                  </Field>
                  <Field label="Nome da campanha">
                    <input
                      className="input-custom"
                      value={campaignName}
                      onChange={(e) => setCampaignName(e.target.value)}
                    />
                  </Field>
                </div>
              </div>

              <div className="h-px bg-border" />

              {/* Contatos */}
              <div>
                <SectionTitle>Contatos</SectionTitle>
                
                {/* Modo de seleção */}
                <div className="flex gap-2 mt-4 mb-4 flex-wrap">
                  <SmallBtn
                    onClick={() => setListMode('usuarios')}
                    variant={listMode === 'usuarios' ? 'primary' : 'secondary'}
                  >
                    Etiquetas/Usuários
                  </SmallBtn>
                  <SmallBtn
                    onClick={() => setListMode('grupos')}
                    variant={listMode === 'grupos' ? 'primary' : 'secondary'}
                  >
                    Grupos
                  </SmallBtn>
                  <SmallBtn
                    onClick={() => setListMode('empreendimentos')}
                    variant={listMode === 'empreendimentos' ? 'primary' : 'secondary'}
                  >
                    Empreendimentos
                  </SmallBtn>
                  <SmallBtn
                    onClick={() => setListMode('importar')}
                    variant={listMode === 'importar' ? 'primary' : 'secondary'}
                  >
                    Importar CSV/XLSX
                  </SmallBtn>
                </div>

                {/* Etiquetas/Usuários */}
                {listMode === 'usuarios' && (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="input-custom flex-1"
                        placeholder="Buscar etiquetas..."
                        value={labelQuery}
                        onChange={(e) => setLabelQuery(e.target.value)}
                      />
                      <SmallBtn onClick={loadLabels} disabled={labelsBusy}>
                        {labelsBusy ? 'Carregando...' : 'Buscar'}
                      </SmallBtn>
                    </div>
                    
                    {needSelectLabelHint && (
                      <div className="text-sm text-orange-600 bg-orange-50 px-3 py-2 rounded-lg">
                        Selecione ao menos uma etiqueta
                      </div>
                    )}
                    
                    <div className="border border-border rounded-lg p-3 max-h-60 overflow-y-auto space-y-2">
                      {labelsBusy && !labels.length ? (
                        <div className="text-sm text-muted-foreground text-center py-4">
                          Consultando etiquetas...
                        </div>
                      ) : (
                        <>
                          {labels.map(label => (
                            <label key={label.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted p-2 rounded">
                              <input
                                type="checkbox"
                                checked={selectedLabelIds.includes(label.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedLabelIds(prev => [...prev, label.id]);
                                  } else {
                                    setSelectedLabelIds(prev => prev.filter(x => x !== label.id));
                                  }
                                }}
                              />
                              <span className="text-sm">{label.title}</span>
                            </label>
                          ))}
                          {!labels.length && !labelsBusy && (
                            <div className="text-sm text-muted-foreground text-center py-4">
                              Nenhuma etiqueta encontrada
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    
                    <SmallBtn onClick={loadFromLabels} disabled={labelsBusy}>
                      Carregar contatos das etiquetas
                    </SmallBtn>
                  </div>
                )}

                {/* Grupos */}
                {listMode === 'grupos' && (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="input-custom flex-1"
                        placeholder="Buscar grupos..."
                        value={groupQuery}
                        onChange={(e) => setGroupQuery(e.target.value)}
                      />
                      <SmallBtn onClick={loadGrupos} disabled={groupParticipantsBusy}>
                        {groupParticipantsBusy ? 'Carregando...' : 'Buscar'}
                      </SmallBtn>
                    </div>
                    
                    {needSelectGroupHint && (
                      <div className="text-sm text-orange-600 bg-orange-50 px-3 py-2 rounded-lg">
                        Selecione ao menos um grupo
                      </div>
                    )}
                    
                    {lastParticipantsEmpty && (
                      <div className="text-sm text-orange-600 bg-orange-50 px-3 py-2 rounded-lg">
                        Nenhum participante encontrado nos grupos selecionados
                      </div>
                    )}
                    
                    <div className="border border-border rounded-lg p-3 max-h-60 overflow-y-auto space-y-2">
                      {groupParticipantsBusy && !grupos.length ? (
                        <div className="text-sm text-muted-foreground text-center py-4">
                          Consultando grupos...
                        </div>
                      ) : (
                        <>
                          {grupos.map(grupo => (
                            <label key={grupo.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted p-2 rounded">
                              <input
                                type="checkbox"
                                checked={selectedGroupIds.includes(grupo.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedGroupIds(prev => [...prev, grupo.id]);
                                  } else {
                                    setSelectedGroupIds(prev => prev.filter(x => x !== grupo.id));
                                  }
                                }}
                              />
                              <span className="text-sm">{grupo.name}</span>
                            </label>
                          ))}
                          {!grupos.length && !groupParticipantsBusy && (
                            <div className="text-sm text-muted-foreground text-center py-4">
                              Nenhum grupo encontrado
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    
                    <SmallBtn onClick={loadFromGroups} disabled={groupParticipantsBusy}>
                      {groupParticipantsBusy ? 'Carregando...' : 'Carregar selecionados'}
                    </SmallBtn>
                  </div>
                )}

                {/* Empreendimentos */}
                {listMode === 'empreendimentos' && (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="input-custom flex-1"
                        placeholder="Buscar empreendimentos..."
                        value={empQuery}
                        onChange={(e) => setEmpQuery(e.target.value)}
                      />
                      <SmallBtn onClick={loadEmpreendimentos} disabled={empsBusy}>
                        {empsBusy ? 'Carregando...' : 'Buscar'}
                      </SmallBtn>
                    </div>
                    
                    <div className="border border-border rounded-lg p-3 max-h-60 overflow-y-auto space-y-2">
                      {empreendimentos.map(emp => (
                        <label key={emp.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted p-2 rounded">
                          <input
                            type="checkbox"
                            checked={selectedEmpIds.includes(emp.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedEmpIds(prev => [...prev, emp.id]);
                              } else {
                                setSelectedEmpIds(prev => prev.filter(x => x !== emp.id));
                              }
                            }}
                          />
                          <span className="text-sm">{emp.title}</span>
                        </label>
                      ))}
                      {!empreendimentos.length && (
                        <div className="text-sm text-muted-foreground text-center py-4">
                          Nenhum empreendimento encontrado
                        </div>
                      )}
                    </div>
                    
                    <SmallBtn onClick={loadFromEmps} disabled={empsBusy}>
                      {empsBusy ? 'Carregando...' : 'Carregar contatos'}
                    </SmallBtn>
                  </div>
                )}

                {/* Importar */}
                {listMode === 'importar' && (
                  <div className="space-y-3">
                    <div className="text-sm text-muted-foreground mb-2">
                      Importar contatos (CSV/XLS/XLSX)
                    </div>
                    <div className="text-sm text-muted-foreground mb-2">
                      Colunas obrigatórias: <b>Nome, Telefone</b>. Duplicados são ignorados.
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".csv,.xlsx,.xls"
                          className="input-custom"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleImportFile(file);
                          }}
                        />
                      </div>
                      <div className="flex gap-2">
                        <SmallBtn
                          onClick={() => {
                            const link = document.createElement('a');
                            link.href = '/modelo-contatos.csv';
                            link.download = 'modelo-contatos.csv';
                            link.click();
                          }}
                          variant="secondary"
                          title="Baixar modelo CSV"
                        >
                          Baixar modelo (CSV)
                        </SmallBtn>
                        <SmallBtn
                          onClick={() => {
                            const link = document.createElement('a');
                            link.href = '/modelo-contatos.xlsx';
                            link.download = 'modelo-contatos.xlsx';
                            link.click();
                          }}
                          variant="secondary"
                          title="Baixar modelo XLSX"
                        >
                          Baixar modelo (XLSX)
                        </SmallBtn>
                      </div>
                    </div>
                  </div>
                )}

                {/* Lista de contatos */}
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-4">
                      <div className="text-sm text-muted-foreground">
                        Total: {contacts.length}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Selecionados: {selectedContacts.length}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Salvar:</span>
                        <SmallBtn onClick={() => handleDownloadContacts('csv')} variant="secondary">
                          CSV
                        </SmallBtn>
                        <SmallBtn onClick={() => handleDownloadContacts('xls')} variant="secondary">
                          XLS
                        </SmallBtn>
                        <SmallBtn onClick={() => handleDownloadContacts('xlsx')} variant="secondary">
                          XLSX
                        </SmallBtn>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="input-custom text-sm"
                        placeholder="Filtrar contatos..."
                        value={contactQuery}
                        onChange={(e) => setContactQuery(e.target.value)}
                      />
                      <SmallBtn onClick={toggleSelectAll} variant="secondary">
                        {selectedContacts.length === visibleContacts.length ? 'Desmarcar' : 'Marcar'} todos
                      </SmallBtn>
                      {contacts.some(c => c.srcImported || (c.tags || '').toUpperCase().includes('IMPORT')) && (
                        <SmallBtn onClick={() => clearBySource('importados')} variant="destructive">
                          Limpar importados
                        </SmallBtn>
                      )}
                      {contacts.some(c => c.srcLabel || (c.tags || '').toUpperCase().includes('ETIQUET')) && (
                        <SmallBtn onClick={() => clearBySource('etiquetas')} variant="destructive">
                          Limpar etiquetas
                        </SmallBtn>
                      )}
                      {contacts.some(c => c.srcGroup || (c.tags || '').toUpperCase().includes('GRUPO')) && (
                        <SmallBtn onClick={() => clearBySource('grupos')} variant="destructive">
                          Limpar grupos
                        </SmallBtn>
                      )}
                      {contacts.some(c => c.srcEmp || (c.tags || '').toUpperCase().includes('EMPREEND')) && (
                        <SmallBtn onClick={() => clearBySource('empreendimentos')} variant="destructive">
                          Limpar empreendimentos
                        </SmallBtn>
                      )}
                      <SmallBtn onClick={clearAllContacts} variant="destructive">
                        Limpar lista
                      </SmallBtn>
                    </div>
                  </div>

                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-muted">
                          <tr>
                            <th className="px-4 py-2 text-left text-sm font-medium">
                              <input
                                type="checkbox"
                                checked={selectedContacts.length === visibleContacts.length && visibleContacts.length > 0}
                                onChange={toggleSelectAll}
                              />
                            </th>
                            <th className="px-4 py-2 text-left text-sm font-medium">Nome</th>
                            <th className="px-4 py-2 text-left text-sm font-medium">Telefone</th>
                            <th className="px-4 py-2 text-left text-sm font-medium">Tags</th>
                            <th className="px-4 py-2 text-left text-sm font-medium">Status</th>
                            <th className="px-4 py-2 text-left text-sm font-medium">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleContacts.map((contact) => (
                            <tr 
                              key={contact.id} 
                              className={`border-t border-border hover:bg-muted/50 ${
                                contact.validationError ? 'bg-destructive/5' : 
                                contact.validationWarning ? 'bg-yellow-500/5' : ''
                              }`}
                            >
                              <td className="px-4 py-2">
                                <input
                                  type="checkbox"
                                  checked={selectedContacts.includes(contact.id)}
                                  onChange={() => toggleContact(contact.id)}
                                />
                              </td>
                              <td className="px-4 py-2 text-sm">{contact.name}</td>
                              <td className="px-4 py-2 text-sm font-mono">
                                {formatPhoneLocal(contact.phone)}
                              </td>
                              <td className="px-4 py-2 text-sm text-muted-foreground">{contact.tags || '-'}</td>
                              <td className="px-4 py-2 text-sm">
                                {contact.validationError ? (
                                  <span className="text-destructive text-xs" title={contact.validationError}>
                                    ❌ {contact.validationError}
                                  </span>
                                ) : contact.validationWarning ? (
                                  <span className="text-yellow-600 dark:text-yellow-500 text-xs" title={contact.validationWarning}>
                                    ⚠️ {contact.validationWarning}
                                  </span>
                                ) : (
                                  <span className="text-green-600 dark:text-green-500 text-xs">✅ Válido</span>
                                )}
                              </td>
                              <td className="px-4 py-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => removeContact(contact.id)}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                          {!visibleContacts.length && (
                            <tr>
                              <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                                Nenhum contato na lista
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Paginação */}
                  {totalContactsPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-4">
                      <SmallBtn
                        onClick={() => setContactsPage(p => Math.max(1, p - 1))}
                        disabled={contactsPage === 1}
                        variant="secondary"
                      >
                        Anterior
                      </SmallBtn>
                      <span className="text-sm text-muted-foreground">
                        Página {contactsPage} de {totalContactsPages}
                      </span>
                      <SmallBtn
                        onClick={() => setContactsPage(p => Math.min(totalContactsPages, p + 1))}
                        disabled={contactsPage === totalContactsPages}
                        variant="secondary"
                      >
                        Próxima
                      </SmallBtn>
                    </div>
                  )}
                </div>
              </div>

              <div className="h-px bg-border" />

              {/* Mensagens */}
              <div>
                <SectionTitle>
                  <span>Mensagem</span>
                </SectionTitle>
                  <div className="flex gap-2 flex-wrap mt-4">
                    {blockButtonsVisibility.text && (
                      <SmallBtn onClick={() => addBlock('text')}>+ Texto</SmallBtn>
                    )}
                    {blockButtonsVisibility.image && (
                      <SmallBtn onClick={() => addBlock('image')}>+ Imagem</SmallBtn>
                    )}
                    {blockButtonsVisibility.video && (
                      <SmallBtn onClick={() => addBlock('video')}>+ Vídeo</SmallBtn>
                    )}
                    {blockButtonsVisibility.audio && (
                      <SmallBtn onClick={() => addBlock('audio')}>+ Áudio</SmallBtn>
                    )}
                    {blockButtonsVisibility.document && (
                      <SmallBtn onClick={() => addBlock('document')}>+ Documento</SmallBtn>
                    )}
                    {blockButtonsVisibility.link && (
                      <SmallBtn onClick={() => addBlock('link')}>+ Link</SmallBtn>
                    )}
                    {blockButtonsVisibility.list && (
                      <SmallBtn onClick={() => addBlock('list')}>+ Lista</SmallBtn>
                    )}
                    {blockButtonsVisibility.poll && (
                      <SmallBtn onClick={() => addBlock('poll')}>+ Enquete</SmallBtn>
                    )}
                  </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
                  {/* Editor de blocos */}
                  <div className="space-y-4">
                    {blocks.map((block, idx) => (
                      <div key={block.id} className="border border-border rounded-lg p-4 bg-card">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-muted-foreground">#{idx + 1}</span>
                            <span className="status-pill status-pill-info">{TYPE_LABEL[block.type]}</span>
                            <span className="text-xs text-muted-foreground">⏱️ {block.itemWait || 0}s</span>
                          </div>
                          <div className="flex gap-1">
                            <SmallBtn onClick={() => moveBlockUp(block.id)} variant="secondary" title="Mover para cima">
                              ↑
                            </SmallBtn>
                            <SmallBtn onClick={() => moveBlockDown(block.id)} variant="secondary" title="Mover para baixo">
                              ↓
                            </SmallBtn>
                            <SmallBtn onClick={() => duplicateBlock(block.id)} variant="secondary" title="Duplicar">
                              📋
                            </SmallBtn>
                             <SmallBtn 
                               onClick={() => {
                                 setDeleteConfirm({
                                   show: true,
                                   type: 'block',
                                   callback: () => {
                                     removeBlock(block.id);
                                     setDeleteConfirm({ show: false, type: '' });
                                   }
                                 });
                               }} 
                               variant="destructive" 
                               title="Remover"
                             >
                               ×
                             </SmallBtn>
                          </div>
                        </div>

                        {/* Composição por Blocos - Header com instruções */}
                        <div className="mb-3 text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded">
                          💡 Use <b>{'{{nome}}'}</b> para nome do contato e <b>{'{{data}}'}</b> para a data
                        </div>

                        {/* Text */}
                        {block.type === 'text' && (
                          <EmojiTextarea
                            value={block.data.text || ''}
                            onChange={(text) => updateBlockData(block.id, { text })}
                            placeholder="Digite sua mensagem..."
                          />
                        )}

                        {/* Image */}
                        {block.type === 'image' && (
                          <div className="space-y-2">
                            <Field label="Legenda (opcional)">
                              <EmojiTextarea
                                value={block.data.caption || ''}
                                onChange={(caption) => updateBlockData(block.id, { caption })}
                                placeholder="Legenda da imagem..."
                              />
                            </Field>
                            <FileUpload
                              blk={block}
                              accept="image/*"
                              onUploaded={(info) => updateBlockData(block.id, { 
                                url: info.url, 
                                _file: { name: info.name, type: info.type },
                                _supaPath: info.path 
                              })}
                            />
                          </div>
                        )}

                        {/* Video */}
                        {block.type === 'video' && (
                          <div className="space-y-2">
                            <Field label="Legenda (opcional)">
                              <EmojiTextarea
                                value={block.data.caption || ''}
                                onChange={(caption) => updateBlockData(block.id, { caption })}
                                placeholder="Legenda do vídeo..."
                              />
                            </Field>
                            <FileUpload
                              blk={block}
                              accept="video/*"
                              onUploaded={(info) => updateBlockData(block.id, { 
                                url: info.url, 
                                _file: { name: info.name, type: info.type },
                                _supaPath: info.path 
                              })}
                            />
                          </div>
                        )}

                        {/* Audio */}
                        {block.type === 'audio' && (
                          <div className="space-y-2">
                            <FileUpload
                              blk={block}
                              accept="audio/*"
                              onUploaded={(info) => updateBlockData(block.id, { 
                                url: info.url, 
                                _file: { name: info.name, type: info.type },
                                _supaPath: info.path 
                              })}
                            />
                          </div>
                        )}

                        {/* Document */}
                        {block.type === 'document' && (
                          <div className="space-y-2">
                            <Field label="Nome do arquivo">
                              <input
                                className="input-custom"
                                value={block.data.filename || ''}
                                onChange={(e) => updateBlockData(block.id, { filename: e.target.value })}
                                placeholder="documento.pdf"
                              />
                            </Field>
                            <Field label="Legenda (opcional)">
                              <EmojiTextarea
                                value={block.data.caption || ''}
                                onChange={(caption) => updateBlockData(block.id, { caption })}
                              />
                            </Field>
                            <FileUpload
                              blk={block}
                              accept=".pdf,.doc,.docx,.xls,.xlsx"
                              onUploaded={(info) => updateBlockData(block.id, { 
                                url: info.url, 
                                filename: info.name,
                                _file: { name: info.name, type: info.type },
                                _supaPath: info.path 
                              })}
                            />
                          </div>
                        )}

                        {/* Link */}
                        {block.type === 'link' && (
                          <div className="space-y-2">
                            <Field label="URL">
                              <EmojiInput
                                value={block.data.url || ''}
                                onChange={(url) => updateBlockData(block.id, { url })}
                                placeholder="https://..."
                              />
                            </Field>
                            <Field label="Título">
                              <EmojiInput
                                value={block.data.title || ''}
                                onChange={(title) => updateBlockData(block.id, { title })}
                                placeholder="Título do link"
                              />
                            </Field>
                            <Field label="Descrição">
                              <EmojiTextarea
                                value={block.data.description || ''}
                                onChange={(description) => updateBlockData(block.id, { description })}
                                placeholder="Descrição do link..."
                              />
                            </Field>
                          </div>
                        )}

                        {/* List */}
                        {block.type === 'list' && (
                          <ListEditor
                            data={block.data}
                            onChange={(newData) => updateBlockData(block.id, newData)}
                          />
                        )}

                        {/* Poll */}
                        {block.type === 'poll' && (
                          <PollEditor
                            data={block.data}
                            onChange={(newData) => updateBlockData(block.id, newData)}
                          />
                        )}

                        {/* Delay */}
                        <div className="mt-3 pt-3 border-t border-border">
                          <Field label="Aguardar antes do próximo (segundos)" hint="Tempo de espera após enviar este bloco">
                            <input
                              type="number"
                              className="input-custom"
                              value={block.itemWait}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, itemWait: val } : b));
                              }}
                              min={0}
                            />
                          </Field>
                        </div>
                      </div>
                    ))}

                    {!blocks.length && (
                      <div className="border border-dashed border-border rounded-lg p-8 text-center text-muted-foreground">
                        Adicione blocos de mensagem usando os botões acima
                      </div>
                    )}
                  </div>

                  {/* Preview WhatsApp */}
                  <div className="lg:sticky lg:top-6 h-fit">
                    <div className="mb-3">
                      <Field label="Nome de exemplo para preview">
                        <input
                          className="input-custom"
                          value={sampleName}
                          onChange={(e) => setSampleName(e.target.value)}
                          placeholder="João Silva"
                        />
                      </Field>
                    </div>
                    <WAPreview blocks={blocks} sampleName={sampleName} />
                  </div>
                </div>
              </div>

              <div className="h-px bg-border" />

              {/* Configurações de envio */}
              <div>
                <SectionTitle>Configurações de envio</SectionTitle>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                  <Field label="Delay entre blocos (s)" hint="Tempo de espera padrão entre blocos">
                    <input
                      type="number"
                      className="input-custom"
                      value={itemDelay}
                      onChange={(e) => setItemDelay(parseInt(e.target.value) || 0)}
                      min={0}
                    />
                  </Field>
                  <Field label="Variação (±s)" hint="Variação aleatória do delay entre blocos">
                    <input
                      type="number"
                      className="input-custom"
                      value={itemVariance}
                      onChange={(e) => setItemVariance(parseInt(e.target.value) || 0)}
                      min={0}
                    />
                  </Field>
                  <Field label="Delay entre contatos (s)" hint="Tempo de espera entre cada contato">
                    <input
                      type="number"
                      className="input-custom"
                      value={contactDelay}
                      onChange={(e) => setContactDelay(parseInt(e.target.value) || 0)}
                      min={0}
                    />
                  </Field>
                  <Field label="Variação (±s)" hint="Variação aleatória do delay entre contatos">
                    <input
                      type="number"
                      className="input-custom"
                      value={contactVariance}
                      onChange={(e) => setContactVariance(parseInt(e.target.value) || 0)}
                      min={0}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <Field label="Código de país padrão" hint="Para números sem código de país">
                    <input
                      className="input-custom"
                      value={defaultCountryCode}
                      onChange={(e) => setDefaultCountryCode(e.target.value)}
                      placeholder="55"
                    />
                  </Field>
                  <Field label="Agendar para (opcional)" hint="Deixe vazio para enviar agora">
                    <input
                      type="datetime-local"
                      className="input-custom"
                      value={schedule}
                      onChange={(e) => setSchedule(e.target.value)}
                    />
                  </Field>
                </div>

                <div className="mt-6 space-y-3">
                  {!isFormValid && (
                    <div className="text-sm text-orange-600 bg-orange-50 dark:bg-orange-950/30 px-4 py-3 rounded-lg">
                      ⚠️ Complete todos os campos obrigatórios: perfil, contatos e mensagens
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      className={`btn-custom flex-1 transition-all ${
                        isFormValid 
                          ? 'bg-primary hover:bg-primary/90 text-primary-foreground' 
                          : 'bg-muted text-muted-foreground cursor-not-allowed'
                      }`}
                      onClick={handleSend}
                      disabled={sending || !isFormValid}
                    >
                      {sending ? 'Criando campanha...' : schedule ? 'Agendar envio' : 'Enviar agora'}
                    </button>
                    {editMode !== 'none' && (
                      <button
                        type="button"
                        className="btn-custom flex-1 btn-ghost-custom"
                        onClick={handleCancelEditClone}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: MONITOR */}
          {tab === 'monitor' && (
            <div className="space-y-6">
              <SectionTitle>Campanhas</SectionTitle>
              <div className="flex items-center justify-end gap-2">
                <SmallBtn onClick={loadMonitor} disabled={monitorBusy}>
                  {monitorBusy ? 'Carregando...' : 'Atualizar'}
                </SmallBtn>
                <Button
                  variant="default"
                  onClick={() => setTab('direct')}
                >
                  Criar Campanha
                </Button>
              </div>

              <div className="border border-border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm font-medium">ID</th>
                        <th className="px-4 py-2 text-left text-sm font-medium">Nome</th>
                        <th className="px-4 py-2 text-left text-sm font-medium">Status</th>
                        <th className="px-4 py-2 text-left text-sm font-medium">Agendado</th>
                        <th className="px-4 py-2 text-left text-sm font-medium">Progresso</th>
                        <th className="px-4 py-2 text-left text-sm font-medium">Processados</th>
                        <th className="px-4 py-2 text-left text-sm font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queueRows.map((q) => {
                        const progress = q.progress_contact_ix && q.contacts_count
                          ? Math.round((q.progress_contact_ix / q.contacts_count) * 100)
                          : 0;
                        
                        return (
                          <tr key={q.Id} className="border-t border-border hover:bg-muted/50">
                            <td className="px-4 py-2 text-sm font-mono">{q.Id}</td>
                            <td className="px-4 py-2 text-sm font-medium">
                              {(() => {
                                const reenvioMatch = q.name.match(/^(.+?)\s*-\s*Reenvio\s+(\d+)$/i);
                                if (reenvioMatch) {
                                  return (
                                    <>
                                      {reenvioMatch[1]}
                                      <span className="text-blue-600 dark:text-blue-400 font-semibold"> - Reenvio {reenvioMatch[2]}</span>
                                    </>
                                  );
                                }
                                return q.name;
                              })()}
                            </td>
                            <td className="px-4 py-2">
                              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                                (q.status === 'completed' || q.status === 'done') ? 'badge-done' :
                                q.status === 'running' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                                q.status === 'scheduled' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' :
                                q.status === 'paused' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                q.status === 'cancelled' ? 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400' :
                                q.status === 'failed' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                                'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                              }`}>
                                {q.status === 'scheduled' ? 'agendado' :
                                 q.status === 'running' ? 'executando' :
                                 q.status === 'completed' ? 'feito' :
                                 q.status === 'paused' ? 'pausado' :
                                 q.status === 'cancelled' ? 'cancelado' :
                                 q.status === 'failed' ? 'erro' :
                                 q.status}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-sm text-muted-foreground">
                              {q.scheduled_for ? formatBRDateTime(q.scheduled_for) : '-'}
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                                  <div
                                    className="bg-primary h-full transition-all"
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-2 text-sm text-muted-foreground whitespace-nowrap">
                              {q.progress_contact_ix || 0}/{q.contacts_count || 0}
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex gap-1 items-center">
                                {(q.status === 'scheduled' || q.status === 'running') && !q.is_paused && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    onClick={() => handlePauseQueue(q.Id)}
                                    title="Pausar"
                                  >
                                    <Pause className="h-4 w-4" />
                                  </Button>
                                )}
                                {q.is_paused && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    onClick={() => handleResumeQueue(q.Id)}
                                    title="Retomar"
                                  >
                                    <Play className="h-4 w-4" />
                                  </Button>
                                )}
                                {(q.status === 'scheduled' || q.status === 'running') && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    onClick={() => handleCancelQueue(q.Id)}
                                    title="Cancelar"
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => handleDownloadExcel(q.Id, q.name, q.run_id)}
                                  title="Baixar Excel"
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                                {(q.status === 'failed' || q.status === 'erro') && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                                    onClick={() => setResendConfirm({ show: true, queueId: q.Id, queueName: q.name })}
                                    title="Reenviar Pendentes"
                                  >
                                    <RefreshCw className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => handleCloneQueue(q.Id)}
                                  title="Clonar campanha"
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => handleEditQueue(q.Id)}
                                  title="Editar"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => handleDeleteQueue(q.Id)}
                                  title="Excluir"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!queueRows.length && (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                            Nenhuma campanha encontrada
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Paginação do monitor */}
              {Math.ceil(totalRows / pageSize) > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <SmallBtn
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    variant="secondary"
                  >
                    Anterior
                  </SmallBtn>
                  <span className="text-sm text-muted-foreground">
                    Página {page} de {Math.ceil(totalRows / pageSize)}
                  </span>
                  <SmallBtn
                    onClick={() => setPage(p => Math.min(Math.ceil(totalRows / pageSize), p + 1))}
                    disabled={page === Math.ceil(totalRows / pageSize)}
                    variant="secondary"
                  >
                    Próxima
                  </SmallBtn>
                </div>
              )}
            </div>
          )}

      {/* Debug Panel */}
      <div className="mt-6">
        <button className="btn-ghost-custom text-sm" onClick={() => setDebugOpen(v => !v)}>
          {debugOpen ? '▼' : '►'} Debug
        </button>
        {debugOpen && (
          <div className="mt-2 space-y-3 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="p-2 rounded border border-border">
                <div className="font-semibold mb-1">🔍 Detectado da URL</div>
                <div className={originCanon ? 'text-green-600' : 'text-red-600'}>
                  originCanon: {originCanon || '❌ NÃO DETECTADO'}
                </div>
                <div className={accountId ? 'text-green-600' : 'text-red-600'}>
                  accountId: {accountId || '❌ NÃO DETECTADO'}
                </div>
                <div className={inboxId ? 'text-green-600' : 'text-muted-foreground'}>
                  inboxId: {inboxId || '(vazio)'}
                </div>
                <div className={conversationId ? 'text-green-600' : 'text-muted-foreground'}>
                  conversationId: {conversationId || '(vazio)'}
                </div>
                <div className="mt-2 space-y-1">
                  <Input
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    placeholder="Cole aqui a URL do Chatwoot (ex.: https://chat.seuapp/app/accounts/2/conversations/2176)"
                    className="h-8 text-xs"
                  />
                  <div className="flex flex-wrap gap-1">
                    <SmallBtn variant="secondary" onClick={() => parseAndApplyFromUrl(manualUrl)}>Detectar da URL colada</SmallBtn>
                    <SmallBtn variant="secondary" onClick={tryReadTop}>Ler do topo</SmallBtn>
                    <SmallBtn variant="secondary" onClick={() => { try { const last = localStorage.getItem('cw_url_last') || ''; if (last) parseAndApplyFromUrl(last); else setDetectMsg('Nenhuma URL salva.'); } catch {} }}>Usar última</SmallBtn>
                    <SmallBtn variant="secondary" onClick={() => { try { if (window.parent && window.parent !== window) { const names = ['REQUEST_CHATWOOT_URL','GET_APP_CONTEXT','DASHBOARD_APP_CONTEXT','APP_CONTEXT_REQUEST','getContext','CW_GET_CONTEXT','chatwoot:getContext']; names.forEach((t) => window.parent.postMessage({ type: t, event: t }, '*')); } } catch {} }}>Solicitar contexto</SmallBtn>
                  </div>
                  {detectMsg && <div className="text-muted-foreground">{detectMsg}</div>}
                </div>
                </div>
              <div className="p-2 rounded border border-border">
                <div className="font-semibold mb-1">⚙️ Perfil Carregado</div>
                <div>hasChatwootAccess: {String(hasChatwootAccess)}</div>
                <div>hasCvAccess: {String(hasCvAccess)}</div>
                <div className={tenantConfig?.admin_apikey ? 'text-green-600' : 'text-red-600'}>
                  admin_apikey: {tenantConfig?.admin_apikey ? '✅ PRESENTE' : '❌ AUSENTE'}
                </div>
                <div>cv_url: {empresasTokensData?.cv_url || '(vazio)'}</div>
                <div>cv_email: {empresasTokensData?.cv_email ? '✅' : '❌'}</div>
                <div>cv_apikey: {mask(empresasTokensData?.cv_apikey)}</div>
              </div>
            </div>
            <div className="flex gap-2">
              <SmallBtn onClick={copyDebug} variant="secondary">Copiar logs</SmallBtn>
              <SmallBtn onClick={() => setDebugLogs([])} variant="secondary">Limpar</SmallBtn>
            </div>
            <div className="border border-border rounded p-2 max-h-64 overflow-auto bg-muted/30">
              {debugLogs.map((l) => (
                <div key={l.id} className="mb-2">
                  <div className="font-mono">{l.ts} [{l.scope}] - {l.message}</div>
                  {l.data && (
                    <pre className="whitespace-pre-wrap break-all">{JSON.stringify(l.data, null, 2)}</pre>
                  )}
                </div>
              ))}
              {!debugLogs.length && <div className="text-muted-foreground">Sem eventos ainda.</div>}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 text-xs text-muted-foreground">{status}</div>
        </div>
      </div>
      
      {/* AlertDialog para confirmações de exclusão */}
      <AlertDialog open={deleteConfirm.show} onOpenChange={(open) => !open && setDeleteConfirm({ show: false, type: '' })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirm.type === 'contact' && 'Deseja realmente remover este contato da lista?'}
              {deleteConfirm.type === 'all-contacts' && 'Deseja realmente remover TODOS os contatos da lista? Esta ação não pode ser desfeita.'}
              {deleteConfirm.type === 'clear-source' && 'Deseja realmente remover todos os contatos desta origem?'}
              {deleteConfirm.type === 'block' && 'Deseja realmente excluir este bloco de mensagem? O arquivo será removido do armazenamento.'}
              {deleteConfirm.type === 'campaign' && 'Deseja realmente excluir esta campanha? Esta ação não pode ser desfeita.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirm({ show: false, type: '' })}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm.callback?.()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirmar exclusão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog para confirmação de reenvio de pendentes */}
      <AlertDialog open={resendConfirm.show} onOpenChange={(open) => !open && setResendConfirm({ show: false, queueId: null, queueName: '' })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reenviar Pendentes</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>Será criada uma nova campanha para reenviar os contatos pendentes:</p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li><strong>Removidos:</strong> Contatos já enviados com sucesso</li>
                <li><strong>Selecionados:</strong> Contatos válidos pendentes (sem erro anterior)</li>
                <li><strong>Desmarcados:</strong> Contatos que falharam no envio anterior e números inválidos</li>
              </ul>
              <p className="text-sm font-medium mt-3">A campanha será iniciada imediatamente após a confirmação.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setResendConfirm({ show: false, queueId: null, queueName: '' })}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resendConfirm.queueId && handleResendPending(resendConfirm.queueId)}
              className="bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              Confirmar Reenvio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Modal Detectar Perfil */}
      <Dialog open={showDetectProfileModal} onOpenChange={setShowDetectProfileModal}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>🔍 Detectar Perfil Automaticamente</DialogTitle>
            <DialogDescription>
              Cole a URL completa da página do Chatwoot para detectar automaticamente o perfil e configurações.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="url-detect">URL do Chatwoot</Label>
              <Input
                id="url-detect"
                placeholder="https://app.chatwoot.com/app/accounts/2/conversations/1428"
                value={urlToDetect}
                onChange={(e) => setUrlToDetect(e.target.value)}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                💡 Exemplo: cole a URL da conversa ou página de inbox do Chatwoot
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowDetectProfileModal(false);
                setUrlToDetect('');
              }}
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleDetectFromUrl}
              disabled={!urlToDetect.trim()}
            >
              🔍 Detectar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
