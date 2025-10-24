import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { SectionTitle } from '@/components/SectionTitle';
import { Field } from '@/components/Field';
import { SmallBtn } from '@/components/SmallBtn';
import { EmojiTextarea } from '@/components/EmojiTextarea';
import { EmojiInput } from '@/components/EmojiInput';
import { WAPreview } from '@/components/WAPreview';
import { FileUpload } from '@/components/FileUpload';
import { ListEditor } from '@/components/ListEditor';
import { PollEditor } from '@/components/PollEditor';
import {
  uid,
  stripDigits,
  ensureE164,
  formatPhoneLocal,
  getSafeContext,
  normalizeOrigin,
  canonOrigin,
  formatBRDateTime,
  rand,
  downloadBlob,
  isHttpUrl,
  normalizeAction
} from '@/lib/utils-envio';
import {
  WEBHOOK_LIST_USERS,
  WEBHOOK_LIST_ENTS,
  WEBHOOK_LIST_GROUPS,
  WEBHOOK_LIST_GROUP_PARTICIPANTS,
  NOCO_TABLE_PROFILES_ID,
  NOCO_TENANT_TABLE_ID,
  NOCO_TENANT_VIEW_ID,
  NOCO_URL,
  NOCO_TOKEN
} from '@/lib/config';
import {
  queueCreate,
  queuePatch,
  queueDelete,
  nocoGET,
  logsListByQueueId,
  logsListForRun
} from '@/lib/noco-api';
import { Contact, Block, Label, Group, Empreendimento, Profile, QueueRecord, TenantConfig } from '@/types/envio';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  const originCanon = canonOrigin(originNo);

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

  // Tenant config
  const [tenantConfig, setTenantConfig] = useState<TenantConfig | null>(null);
  const [hasChatwootAccess, setHasChatwootAccess] = useState<boolean | null>(null);
  const [hasCvAccess, setHasCvAccess] = useState<boolean | null>(null);

  // Perfis
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [profilesError, setProfilesError] = useState('');

  // Campanha
  const [campaignName, setCampaignName] = useState('Campanha');

  // Labels/Etiquetas
  const [labels, setLabels] = useState<Label[]>([]);
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

  // Blocos de mensagem
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [sampleName, setSampleName] = useState('João Silva');

  // Agendamento e delays
  const [schedule, setSchedule] = useState('');
  const [defaultCountryCode, setDefaultCountryCode] = useState('55');
  const [itemDelay, setItemDelay] = useState(3);
  const [itemVariance, setItemVariance] = useState(4);
  const [contactDelay, setContactDelay] = useState(10);
  const [contactVariance, setContactVariance] = useState(10);

  // Envio
  const [sending, setSending] = useState(false);
  const [editingQueueId, setEditingQueueId] = useState<string | number | null>(null);

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

  // Carregar configuração do tenant (busca na tabela evo_profiles)
  async function loadTenantConfig() {
    if (!originCanon) {
      console.log('[tenantConfig] Aguardando originCanon...');
      return null;
    }

    try {
      console.log('[tenantConfig] Buscando perfil na evo_profiles:', { originCanon, accountId });
      const baseUrl = NOCO_URL;
      let data: any = null;

      // Se temos account_id, busca com ambos os filtros na tabela evo_profiles
      if (accountId) {
        const where = `(account_id,eq,${accountId})~and(chatwoot_origin,eq,${originCanon})`;
        const url = `${baseUrl}/api/v2/tables/${NOCO_TABLE_PROFILES_ID}/records?offset=0&limit=25&where=${encodeURIComponent(where)}`;
        console.log('[tenantConfig] URL com account_id (evo_profiles):', url);
        data = await nocoGET(url).catch((err) => {
          console.error('[tenantConfig] Erro na busca com account_id:', err);
          return null;
        });
      }

      // Se não encontrou com account_id ou não tem account_id, busca só pelo origin
      if (!data || !Array.isArray(data.list) || data.list.length === 0) {
        const where = `(chatwoot_origin,eq,${originCanon})`;
        const url = `${baseUrl}/api/v2/tables/${NOCO_TABLE_PROFILES_ID}/records?offset=0&limit=25&where=${encodeURIComponent(where)}`;
        console.log('[tenantConfig] URL sem account_id (evo_profiles):', url);
        data = await nocoGET(url).catch((err) => {
          console.error('[tenantConfig] Erro na busca sem account_id:', err);
          return null;
        });
      }

      const list = (Array.isArray(data?.list) ? data.list : []).map((r: any) => ({
        id: String(r.Id ?? r.id ?? ''),
        chatwoot_origin: (r.chatwoot_origin || '').trim(),
        account_id: String(r.account_id ?? ''),
        is_active: !!(r.is_active === true || r.is_active === 'true' || r.is_active === 1),
        cv_activa: !!(r.cv_activa === true || r.cv_activa === 'true' || r.cv_activa === 1 || r.cv_active === true || r.cv_active === 'true' || r.cv_active === 1),
        admin_apikey: r.admin_apikey || '',
        cv_email: r.cv_email || '',
        cv_apikey: r.cv_apikey || '',
        default: !!r.default
      }));

      console.log('[tenantConfig] Records completos do NocoDB:', data?.list?.map((r: any) => ({
        Id: r.Id,
        chatwoot_origin: r.chatwoot_origin,
        account_id: r.account_id,
        admin_apikey: r.admin_apikey ? '✅ presente' : '❌ ausente',
        admin_apikey_value: r.admin_apikey
      })));

      console.log('[tenantConfig] Lista recebida:', list);

      // Filtra pelo accountId se disponível
      const filtered = accountId 
        ? list.filter((r: any) => String(r.account_id) === String(accountId))
        : list;

      if (!filtered.length) {
        console.log('[tenantConfig] ❌ Nenhum tenant encontrado');
        setTenantConfig(null);
        setHasChatwootAccess(false);
        setHasCvAccess(false);
        return null;
      }

      const chosen = filtered.find((x: any) => x.default) || filtered[0];
      console.log('[tenantConfig] ✅ Tenant escolhido:', chosen);

      // Atualiza accountId se não estava definido
      if (!accountId && chosen && chosen.account_id) {
        console.log('[tenantConfig] Definindo accountId:', chosen.account_id);
        setAccountId(String(chosen.account_id));
      }

      setTenantConfig(chosen);
      setHasChatwootAccess(!!(chosen.admin_apikey) && chosen.is_active === true);
      setHasCvAccess(chosen.cv_activa || chosen.cv_active);

      // Expor variáveis globais
      if (typeof window !== 'undefined') {
        (window as any).__ADMIN_APIKEY__ = chosen.admin_apikey || '';
        (window as any).__ACCOUNT_ID__ = String(chosen.account_id || accountId || '');
        (window as any).__INBOX_ID__ = String(inboxId || '');
        (window as any).__CONVERSATION_ID__ = String(conversationId || '');
        (window as any).__FORCE_ORIGIN__ = originCanon;
        console.log('[tenantConfig] Variáveis globais definidas:', {
          __ADMIN_APIKEY__: chosen.admin_apikey ? '✅ definido' : '❌ vazio',
          __ACCOUNT_ID__: chosen.account_id || accountId,
          __INBOX_ID__: inboxId,
          __CONVERSATION_ID__: conversationId
        });
      }

      return chosen;
    } catch (e) {
      console.error('[tenantConfig] Erro geral:', e);
      setTenantConfig(null);
      setHasChatwootAccess(false);
      setHasCvAccess(false);
      return null;
    }
  }

  useEffect(() => {
    if (originCanon) {
      loadTenantConfig();
    }
  }, [originCanon, accountId]);

  // Helper: extrai IDs do pathname do Chatwoot
  function extractIdsFromPath(pathname: string) {
    const acc = pathname.match(/\/accounts\/(\d+)(?:\/|$)/i)?.[1] || '';
    const inbox = pathname.match(/\/inbox(?:es)?\/(\d+)(?:\/|$)/i)?.[1] || '';
    const conv = pathname.match(/\/conversations\/(\d+)(?:\/|$)/i)?.[1] || '';
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
  }

  function parseAndApplyFromUrl(raw: string) {
    try {
      const u = new URL(raw);
      setParentPathInfo({ href: u.href, pathname: u.pathname });
      const ids = extractIdsFromPath(u.pathname);
      applyIds(ids.acc, ids.inbox, ids.conv);
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

  // Detecta account_id, inbox_id e conversation_id
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      const currentUrl = window.location.href;
      const ref = typeof document !== 'undefined' ? document.referrer : '';
      console.log('[URL Detection] Current URL:', currentUrl);
      console.log('[URL Detection] Referrer (Chatwoot):', ref || '—');
      
      const u = new URL(currentUrl);
      
      // 1) Query string local
      const params = u.searchParams;
      let acc = params.get('account_id') || params.get('accountId') || params.get('account') || params.get('acc') || '';
      let inbox = params.get('inbox_id') || params.get('inboxId') || params.get('inbox') || '';
      let conv = params.get('conversation_id') || params.get('conversationId') || params.get('conversation') || '';

      // 2) Hash local
      if ((!acc || !inbox || !conv) && u.hash) {
        const hashParams = new URLSearchParams(u.hash.replace(/^#/, ''));
        acc = acc || (hashParams.get('account_id') || hashParams.get('accountId') || hashParams.get('account') || hashParams.get('acc') || '');
        inbox = inbox || (hashParams.get('inbox_id') || hashParams.get('inboxId') || hashParams.get('inbox') || '');
        conv = conv || (hashParams.get('conversation_id') || hashParams.get('conversationId') || hashParams.get('conversation') || '');
      }

      // 3) Pathname local (quando app estiver sob o mesmo domínio)
      if ((!acc || !inbox || !conv) && u.pathname) {
        const idsLocal = extractIdsFromPath(u.pathname);
        if (!acc && idsLocal.acc) acc = idsLocal.acc;
        if (!inbox && idsLocal.inbox) inbox = idsLocal.inbox;
        if (!conv && idsLocal.conv) conv = idsLocal.conv;
      }

      // 4) Referrer (Chatwoot) — cobre os dois formatos
      if (ref) {
        try {
          const ru = new URL(ref);
          const rPath = ru.pathname || '';
          if (rPath && rPath !== '/') {
            const idsRef = extractIdsFromPath(rPath);
            if (!acc && idsRef.acc) acc = idsRef.acc;
            if (!inbox && idsRef.inbox) inbox = idsRef.inbox;
            if (!conv && idsRef.conv) conv = idsRef.conv;
          }
        } catch (e) {
          console.error('[URL Detection] Erro ao processar referrer:', e);
        }
      }

      console.log('[URL Detection] ✅ Valores finais:', { acc, inbox, conv });
      
      if (acc) setAccountId(acc);
      if (inbox) setInboxId(inbox);
      if (conv) setConversationId(conv);
      
    } catch (e) {
      console.error('[URL Detection] Erro geral:', e);
    }
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
            if (acc2) setAccountId(acc2);
            if (inbox2) setInboxId(inbox2);
            if (conv2) setConversationId(conv2);
            if (typeof window !== 'undefined') {
              (window as any).__ACCOUNT_ID__ = acc2 || (window as any).__ACCOUNT_ID__;
              (window as any).__INBOX_ID__ = inbox2 || (window as any).__INBOX_ID__;
              (window as any).__CONVERSATION_ID__ = conv2 || (window as any).__CONVERSATION_ID__;
            }
            console.log('[postMessage] appContext recebido:', { acc2, inbox2, conv2, payload });
            return; // já tratou
          }
        }

        // 1) Se vier uma URL completa
        const maybeUrl = typeof d === 'string' ? d : (d.url || d.href || d.chatwoot_url || d.chatwoot_href);
        if (typeof maybeUrl === 'string' && /^https?:\/\//i.test(maybeUrl)) {
          try {
            const u = new URL(maybeUrl);
            setParentPathInfo({ href: u.href, pathname: u.pathname });
            const ids = extractIdsFromPath(u.pathname);
            if (ids.acc) setAccountId(ids.acc);
            if (ids.inbox) setInboxId(ids.inbox);
            if (ids.conv) setConversationId(ids.conv);
            console.log('[postMessage] URL recebida do parent:', u.href, ids);
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
        if (acc) setAccountId(acc);
        if (inbox) setInboxId(inbox);
        if (conv) setConversationId(conv);
        if (typeof window !== 'undefined') {
          (window as any).__ACCOUNT_ID__ = acc || (window as any).__ACCOUNT_ID__;
          (window as any).__INBOX_ID__ = inbox || (window as any).__INBOX_ID__;
          (window as any).__CONVERSATION_ID__ = conv || (window as any).__CONVERSATION_ID__;
        }
        if (acc || inbox || conv) {
          console.log('[postMessage] IDs recebidos:', { acc, inbox, conv });
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

  async function loadProfiles() {
    if (!originCanon || !accountId) {
      console.log('[Perfis] Aguardando originCanon e accountId...', { originCanon, accountId });
      return;
    }
    
    setLoadingProfiles(true);
    setProfilesError('');
    
    try {
      const where = `(chatwoot_origin,eq,${originCanon})~and(account_id,eq,${accountId})`;
      const url = `${NOCO_URL}/api/v2/tables/${NOCO_TABLE_PROFILES_ID}/records?where=${encodeURIComponent(where)}&limit=1000`;
      
      console.log('[Perfis] Consultando NocoDB:', { originCanon, accountId, url });
      
      const data = await nocoGET(url);
      const list = Array.isArray(data?.list) ? data.list : [];
      
      console.log('[Perfis] Resposta NocoDB:', { total: list.length, list });
      
      const mappedProfiles = list.map((r: any) => ({
        Id: r.Id,
        name: r.name || r.profile_name || 'Perfil',
        origin: r.origin,
        chatwoot_origin: r.chatwoot_origin,
        account_id: r.account_id,
        inbox_id: r.inbox_id,
        admin_apikey: r.admin_apikey || r.adimin_apikey || ''
      }));
      
      setProfiles(mappedProfiles);
      setStatus(`${list.length} perfil(is) carregado(s).`);
      
      console.log('[Perfis] Perfis carregados:', mappedProfiles);
      
    } catch (err: any) {
      console.error('[Perfis] Erro ao carregar:', err);
      setProfilesError(err.message || 'Falha ao carregar perfis');
      setStatus('Erro ao carregar perfis.');
    } finally {
      setLoadingProfiles(false);
    }
  }

  useEffect(() => {
    if (accountId && originCanon) {
      loadProfiles();
    }
  }, [accountId, originCanon]);

  // ========== FUNÇÕES DE CONTATOS ==========
  
  async function handleImportFile(file: File) {
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      
      const imported: Contact[] = [];
      for (const row of rows) {
        const name = String(row['Nome'] || row['nome'] || row['Name'] || row['name'] || '').trim();
        const phoneRaw = String(row['Telefone'] || row['telefone'] || row['Phone'] || row['phone'] || '').trim();
        const tagsRaw = String(row['Tags'] || row['tags'] || row['Etiquetas'] || row['etiquetas'] || '').trim();
        
        if (phoneRaw) {
          const digits = stripDigits(phoneRaw);
          const phone = ensureE164(digits, defaultCountryCode);
          imported.push({
            id: uid(),
            name: name || 'Sem nome',
            phone,
            tags: tagsRaw,
            srcImported: true
          });
        }
      }
      
      setContacts(prev => [...prev, ...imported]);
      setStatus(`Importados ${imported.length} contatos do arquivo.`);
    } catch (e: any) {
      setStatus(`Erro ao importar: ${e.message}`);
    }
  }

  async function loadLabels() {
    if (!hasChatwootAccess || labelsBusy) return;
    setLabelsBusy(true);
    try {
      if (labelsReqRef.current.controller) labelsReqRef.current.controller.abort();
      labelsReqRef.current.controller = new AbortController();
      
      const response = await fetch(WEBHOOK_LIST_USERS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          origin: originCanon, 
          account_id: accountId,
          source: 'etiquetas',
          q: labelQuery 
        }),
        signal: labelsReqRef.current.controller.signal
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const list = Array.isArray(data) ? data : [];
      setLabels(list.map((item: any) => ({
        id: item.id,
        title: item.title || item.name || 'Sem título',
        color: item.color
      })));
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('Erro ao carregar etiquetas:', e);
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
    setLabelsBusy(true);
    try {
      const response = await fetch(WEBHOOK_LIST_USERS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: originCanon,
          account_id: accountId,
          source: 'etiquetas',
          labels: selectedLabelIds
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const users = Array.isArray(data) ? data : [];
      
      const newContacts: Contact[] = users.map((u: any) => ({
        id: uid(),
        name: u.name || 'Sem nome',
        phone: ensureE164(stripDigits(u.phone_number || u.phone || ''), defaultCountryCode),
        tags: '',
        srcLabel: true
      }));
      
      setContacts(prev => [...prev, ...newContacts]);
      setStatus(`${newContacts.length} contatos carregados de etiquetas.`);
    } catch (e: any) {
      setStatus(`Erro: ${e.message}`);
    } finally {
      setLabelsBusy(false);
    }
  }

  async function loadGrupos() {
    if (!hasChatwootAccess) return;
    try {
      const response = await fetch(WEBHOOK_LIST_GROUPS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: originCanon,
          account_id: accountId,
          inbox_id: inboxId,
          q: groupQuery
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const list = Array.isArray(data) ? data : [];
      setGrupos(list.map((g: any) => ({
        id: g.id,
        name: g.subject || g.name || 'Sem nome',
        subject: g.subject
      })));
    } catch (e: any) {
      console.error('Erro ao carregar grupos:', e);
    }
  }

  async function loadFromGroups() {
    if (!selectedGroupIds.length) {
      setNeedSelectGroupHint(true);
      setTimeout(() => setNeedSelectGroupHint(false), 3000);
      return;
    }
    
    if (groupTarget === 'grupos') {
      const newContacts: Contact[] = selectedGroupIds.map(gid => {
        const g = grupos.find(gr => gr.id === gid);
        return {
          id: uid(),
          name: g?.name || 'Grupo',
          phone: gid,
          tags: '',
          srcGroup: true
        };
      });
      setContacts(prev => [...prev, ...newContacts]);
      setStatus(`${newContacts.length} grupos adicionados.`);
    } else {
      setGroupParticipantsBusy(true);
      try {
        const response = await fetch(WEBHOOK_LIST_GROUP_PARTICIPANTS, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin: originCanon,
            account_id: accountId,
            inbox_id: inboxId,
            group_ids: selectedGroupIds
          })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const users = Array.isArray(data) ? data : [];
        
        if (!users.length) {
          setLastParticipantsEmpty(true);
          setTimeout(() => setLastParticipantsEmpty(false), 4000);
        }
        
        const newContacts: Contact[] = users.map((u: any) => ({
          id: uid(),
          name: u.name || 'Sem nome',
          phone: ensureE164(stripDigits(u.id || ''), defaultCountryCode),
          tags: '',
          srcGroup: true
        }));
        
        setContacts(prev => [...prev, ...newContacts]);
        setStatus(`${newContacts.length} participantes carregados.`);
      } catch (e: any) {
        setStatus(`Erro: ${e.message}`);
      } finally {
        setGroupParticipantsBusy(false);
      }
    }
  }

  async function loadEmpreendimentos() {
    if (!hasCvAccess || empsBusy) return;
    setEmpsBusy(true);
    try {
      const response = await fetch(WEBHOOK_LIST_ENTS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: originCanon,
          account_id: accountId,
          q: empQuery
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const list = Array.isArray(data?.data) ? data.data : [];
      setEmpreendimentos(list.map((e: any) => ({
        id: e.id,
        title: e.nome || e.title || 'Sem título',
        codigo: e.codigo
      })));
    } catch (e: any) {
      console.error('Erro ao carregar empreendimentos:', e);
    } finally {
      setEmpsBusy(false);
    }
  }

  async function loadFromEmps() {
    if (!selectedEmpIds.length) {
      setStatus('Selecione ao menos um empreendimento');
      return;
    }
    setEmpsBusy(true);
    try {
      const response = await fetch(WEBHOOK_LIST_ENTS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: originCanon,
          account_id: accountId,
          source: 'empreendimentos',
          emp_ids: selectedEmpIds
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const users = Array.isArray(data) ? data : [];
      
      const newContacts: Contact[] = users.map((u: any) => ({
        id: uid(),
        name: u.name || 'Sem nome',
        phone: ensureE164(stripDigits(u.phone || u.telefone || ''), defaultCountryCode),
        tags: '',
        srcEmp: true
      }));
      
      setContacts(prev => [...prev, ...newContacts]);
      setStatus(`${newContacts.length} contatos carregados de empreendimentos.`);
    } catch (e: any) {
      setStatus(`Erro: ${e.message}`);
    } finally {
      setEmpsBusy(false);
    }
  }

  function removeContact(id: string) {
    setContacts(prev => prev.filter(c => c.id !== id));
    setSelectedContacts(prev => prev.filter(cid => cid !== id));
  }

  function clearAllContacts() {
    if (confirm('Remover todos os contatos da lista?')) {
      setContacts([]);
      setSelectedContacts([]);
    }
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

  function addBlock(type: string) {
    const newBlock: Block = {
      id: uid(),
      type: type as any,
      action: 'sendMessage',
      data: defaultsByType(type),
      itemWait: itemDelay
    };
    setBlocks(prev => [...prev, newBlock]);
  }

  function removeBlock(id: string) {
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
    if (!accountId) {
      setStatus('❌ Erro: account_id não detectado. Cole a URL do Chatwoot manualmente na seção DEBUG.');
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

    setSending(true);
    try {
      const contactsToSend = contacts.filter(c => selectedContacts.includes(c.id));
      
      // Estrutura do payload seguindo o formato do SERVER.mjs
      const payload = {
        name: campaignName,
        status: 'pending',
        scheduled_for: schedule || new Date().toISOString(),
        profile_id: selectedProfile.Id,
        account_id: accountId,
        inbox_id: selectedProfile.inbox_id || inboxId || null,
        conversation_id: conversationId || null,
        chatwoot_origin: originCanon,
        admin_apikey: tenantConfig.admin_apikey,
        contacts_count: contactsToSend.length,
        items_count: blocks.length * contactsToSend.length,
        progress_contact_ix: 0,
        contacts: contactsToSend.map(c => ({
          name: c.name,
          phone: c.phone
        })),
        blocks: blocks.map(b => ({
          type: b.type,
          action: normalizeAction(b.action),
          data: b.data,
          itemWait: b.itemWait
        })),
        delays: {
          itemDelay,
          itemVariance,
          contactDelay,
          contactVariance
        },
        defaultCountryCode
      };

      console.log('[handleSend] Payload completo:', payload);

      const result = await queueCreate(payload);
      console.log('[handleSend] Resultado:', result);
      
      setStatus(`✅ Campanha "${campaignName}" criada com sucesso! ID: ${result.Id || result.id}`);
      setTab('monitor');
      loadMonitor();
      
      // Limpa o formulário após sucesso
      setBlocks([]);
      setSelectedContacts([]);
      setSchedule('');
    } catch (e: any) {
      console.error('[handleSend] Erro:', e);
      setStatus(`❌ Erro ao criar campanha: ${e.message}`);
    } finally {
      setSending(false);
    }
  }

  // ========== FUNÇÕES DO MONITOR ==========

  async function loadMonitor() {
    setMonitorBusy(true);
    try {
      const where = `(account_id,eq,${accountId})~and(chatwoot_origin,eq,${originCanon})`;
      const offset = (page - 1) * pageSize;
      const sortField = queueSort.field === 'Id' ? 'Id' : queueSort.field;
      const sortDir = queueSort.dir === 'desc' ? '-' : '';
      const sort = queueSort.dir === 'normal' ? '' : `&sort=${sortDir}${sortField}`;
      
      const url = `${NOCO_URL}/api/v2/tables/m6zl5h7bz31sxol/records?where=${encodeURIComponent(where)}&offset=${offset}&limit=${pageSize}${sort}`;
      const data = await nocoGET(url);
      
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
      console.error('Erro ao carregar monitor:', e);
    } finally {
      setMonitorBusy(false);
    }
  }

  useEffect(() => {
    if (tab === 'monitor' && accountId && originCanon) {
      loadMonitor();
    }
  }, [tab, page, queueSort, accountId, originCanon]);

  // Atualização automática do monitor (intervalo)
  useEffect(() => {
    if (tab !== 'monitor' || !accountId || !originCanon) return;
    const id = setInterval(() => {
      loadMonitor();
    }, 5000);
    return () => clearInterval(id);
  }, [tab, accountId, originCanon]);

  async function handleDeleteQueue(queueId: string | number) {
    if (!confirm('Deseja realmente excluir esta campanha?')) return;
    try {
      await queueDelete(queueId);
      setStatus('Campanha excluída.');
      loadMonitor();
    } catch (e: any) {
      setStatus(`Erro ao excluir: ${e.message}`);
    }
  }

  async function handlePauseQueue(queueId: string | number) {
    try {
      await queuePatch(queueId, { is_paused: true });
      setStatus('Campanha pausada.');
      loadMonitor();
    } catch (e: any) {
      setStatus(`Erro: ${e.message}`);
    }
  }

  async function handleResumeQueue(queueId: string | number) {
    try {
      await queuePatch(queueId, { is_paused: false });
      setStatus('Campanha retomada.');
      loadMonitor();
    } catch (e: any) {
      setStatus(`Erro: ${e.message}`);
    }
  }

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
          <h1 className="text-3xl font-bold mb-2 text-foreground">Envio em Massa</h1>
          <p className="text-sm text-muted-foreground mb-4">
            Fluxo: perfil → etiquetas/contatos → <b>composição por blocos</b> → <b>upload</b> → <b>agendar</b> e acompanhar.
          </p>

          <details className="mb-3">
            <summary className="underline text-sm text-muted-foreground cursor-pointer">DEBUG - Detecção de URL e Perfis</summary>
            <div className="mt-2 font-mono text-xs text-muted-foreground whitespace-pre-wrap">
              <strong>🌐 URL Detectada:</strong><br/>
              URL completa (local): {typeof window !== 'undefined' ? window.location.href : 'N/A'}<br/>
              URL completa do Chatwoot (origem): {parentPathInfo?.href || (typeof document !== 'undefined' ? (document.referrer || 'N/A') : 'N/A')}<br/>
              referrer pathname: {parentPathInfo?.pathname || refCtx?.pathname || 'N/A'}<br/>

              {/* Ferramentas de detecção manual */}
              <div className="mt-2 p-2 rounded border border-border bg-muted/30">
                <div className="mb-2">Cole a URL do Chatwoot (ex.: https://chat.promobio.com.br/app/accounts/2/conversations/1428):</div>
                <div className="flex gap-2 items-center">
                  <Input value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://chat..." className="h-8" />
                  <Button variant="secondary" className="h-8 px-3" onClick={() => parseAndApplyFromUrl(manualUrl)}>Usar URL</Button>
                  <Button variant="outline" className="h-8 px-3" onClick={tryReadTop}>Tentar do topo</Button>
                </div>
                {detectMsg && (<div className="mt-2 text-[11px]">{detectMsg}</div>)}
              </div>
              <br/>
              <strong>🎯 chatwoot_origin Detectado:</strong><br/>
              chatwoot_origin = {refCtx?.chatwootOrigin || '❌ não detectado'}<br/>
              origin local = {origin}<br/>
              originNo (normalizado) = {originNo}<br/>
              originCanon (canônico) = {originCanon}<br/>
              <br/>
              <strong>📡 appContext:</strong> {appCtx ? '✅ recebido' : '—'}<br/>
              {appCtx && (
                <>
                  account_id(ctx) = {appCtx?.conversation?.account_id || appCtx?.account_id || appCtx?.account?.id || 'N/A'}<br/>
                  inbox_id(ctx) = {appCtx?.conversation?.inbox_id || 'N/A'}<br/>
                  conversation_id(ctx) = {appCtx?.conversation?.display_id || appCtx?.conversation?.id || 'N/A'}<br/>
                  <br/>
                </>
              )}
              <br/>
              <strong>🔑 IDs Extraídos:</strong><br/>
              accountId = {accountId || '❌ não detectado'}<br/>
              inboxId = {inboxId || '❌ não detectado'}<br/>
              conversationId = {conversationId || '❌ não detectado'}<br/>
              <br/>
              <strong>🔐 Tenant Config:</strong><br/>
              admin_api_key (tenant) = {tenantConfig?.admin_apikey ? '✅ ' + tenantConfig.admin_apikey.substring(0, 20) + '...' : '❌ não definido'}<br/>
              tenant configurado = {tenantConfig ? '✅ sim' : '❌ não'}<br/>
              tenant.account_id = {tenantConfig?.account_id || 'N/A'}<br/>
              tenant.chatwoot_origin = {tenantConfig?.chatwoot_origin || 'N/A'}<br/>
              tenant.is_active = {tenantConfig?.is_active ? '✅ sim' : '❌ não'}<br/>
              <br/>
              <strong>📋 Perfis Carregados: {profiles.length}</strong><br/>
              {loadingProfiles && '⏳ Carregando perfis...\n'}
              {profilesError && `❌ Erro: ${profilesError}\n`}
              {profiles.length === 0 && !loadingProfiles && '⚠️ Nenhum perfil encontrado\n'}
              {profiles.length > 0 && profiles.map((p, i) => (
                <span key={p.Id}>
                  [{i+1}] <strong>{p.name}</strong><br/>
                  &nbsp;&nbsp;&nbsp;• Id: {p.Id}<br/>
                  &nbsp;&nbsp;&nbsp;• account_id: {p.account_id}<br/>
                  &nbsp;&nbsp;&nbsp;• inbox_id: {p.inbox_id || 'N/A'}<br/>
                  &nbsp;&nbsp;&nbsp;• chatwoot_origin: {p.chatwoot_origin || 'N/A'}<br/>
                  &nbsp;&nbsp;&nbsp;• admin_apikey: {p.admin_apikey ? '✅ definido' : '❌ não definido'}<br/>
                </span>
              ))}
              <br/>
              <strong>📊 Outros Dados:</strong><br/>
              empreendimentos = {empreendimentos.length}<br/>
              supabase = {tenantConfig ? '✅ configurado' : '❌ não'}<br/>
              uploader = {(typeof window !== 'undefined' && (window as any).__UPLOADER_URL__) ? '✅ configurado' : '❌ não'}<br/>
              noco_url = {NOCO_URL}
            </div>
          </details>
          
          {/* Tabs */}
          <div className="flex gap-1 mb-6 border-b border-border">
            <button
              className={`tab-custom ${tab === 'direct' ? 'tab-custom-active' : 'tab-custom-inactive'}`}
              onClick={() => setTab('direct')}
            >
              Direto
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
                      {profiles.map((p) => (
                        <option key={p.Id} value={p.Id}>
                          {p.name}
                        </option>
                      ))}
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
                      {!labels.length && (
                        <div className="text-sm text-muted-foreground text-center py-4">
                          Nenhuma etiqueta encontrada
                        </div>
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
                      <SmallBtn onClick={loadGrupos}>
                        Buscar
                      </SmallBtn>
                    </div>
                    
                    <div className="flex gap-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="groupTarget"
                          checked={groupTarget === 'grupos'}
                          onChange={() => setGroupTarget('grupos')}
                        />
                        <span className="text-sm">Enviar para os grupos</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="groupTarget"
                          checked={groupTarget === 'participantes'}
                          onChange={() => setGroupTarget('participantes')}
                        />
                        <span className="text-sm">Enviar para participantes</span>
                      </label>
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
                      {!grupos.length && (
                        <div className="text-sm text-muted-foreground text-center py-4">
                          Nenhum grupo encontrado
                        </div>
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
                      Faça upload de um arquivo CSV ou XLSX com colunas: Nome, Telefone, Tags
                    </div>
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="input-custom"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImportFile(file);
                      }}
                    />
                  </div>
                )}

                {/* Lista de contatos */}
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm text-muted-foreground">
                      Total: {contacts.length} • Selecionados: {selectedContacts.length}
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
                            <th className="px-4 py-2 text-left text-sm font-medium">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleContacts.map((contact) => (
                            <tr key={contact.id} className="border-t border-border hover:bg-muted/50">
                              <td className="px-4 py-2">
                                <input
                                  type="checkbox"
                                  checked={selectedContacts.includes(contact.id)}
                                  onChange={() => toggleContact(contact.id)}
                                />
                              </td>
                              <td className="px-4 py-2 text-sm">{contact.name}</td>
                              <td className="px-4 py-2 text-sm font-mono">{formatPhoneLocal(contact.phone)}</td>
                              <td className="px-4 py-2 text-sm text-muted-foreground">{contact.tags || '-'}</td>
                              <td className="px-4 py-2">
                                <SmallBtn onClick={() => removeContact(contact.id)} variant="destructive">
                                  Remover
                                </SmallBtn>
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
                  <div className="flex gap-2">
                    <SmallBtn onClick={() => addBlock('text')}>+ Texto</SmallBtn>
                    <SmallBtn onClick={() => addBlock('image')}>+ Imagem</SmallBtn>
                    <SmallBtn onClick={() => addBlock('video')}>+ Vídeo</SmallBtn>
                    <SmallBtn onClick={() => addBlock('audio')}>+ Áudio</SmallBtn>
                    <SmallBtn onClick={() => addBlock('document')}>+ Documento</SmallBtn>
                    <SmallBtn onClick={() => addBlock('link')}>+ Link</SmallBtn>
                    <SmallBtn onClick={() => addBlock('list')}>+ Lista</SmallBtn>
                    <SmallBtn onClick={() => addBlock('poll')}>+ Enquete</SmallBtn>
                  </div>
                </SectionTitle>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
                  {/* Editor de blocos */}
                  <div className="space-y-4">
                    {blocks.map((block, idx) => (
                      <div key={block.id} className="border border-border rounded-lg p-4 bg-card">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-muted-foreground">#{idx + 1}</span>
                            <span className="status-pill status-pill-info">{TYPE_LABEL[block.type]}</span>
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
                            <SmallBtn onClick={() => removeBlock(block.id)} variant="destructive" title="Remover">
                              ×
                            </SmallBtn>
                          </div>
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

                <div className="mt-6 flex gap-3">
                  <button
                    className="btn-custom btn-custom-primary flex-1"
                    onClick={handleSend}
                    disabled={sending || !selectedProfileId || !selectedContacts.length || !blocks.length}
                  >
                    {sending ? 'Criando campanha...' : schedule ? 'Agendar envio' : 'Enviar agora'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB: MONITOR */}
          {tab === 'monitor' && (
            <div className="space-y-6">
              <SectionTitle>Campanhas</SectionTitle>
              <div className="flex items-center justify-end">
                <SmallBtn onClick={loadMonitor} disabled={monitorBusy}>
                  {monitorBusy ? 'Carregando...' : 'Atualizar'}
                </SmallBtn>
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
                            <td className="px-4 py-2 text-sm font-medium">{q.name}</td>
                            <td className="px-4 py-2">
                              <span className={`status-pill ${
                                q.status === 'completed' ? 'status-pill-success' :
                                q.status === 'running' ? 'status-pill-info' :
                                q.status === 'paused' ? 'status-pill-warning' :
                                q.status === 'failed' ? 'status-pill-error' :
                                'status-pill-default'
                              }`}>
                                {q.status}
                              </span>
                              {q.is_paused && (
                                <span className="status-pill status-pill-warning ml-2">pausado</span>
                              )}
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
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                  {q.progress_contact_ix || 0}/{q.contacts_count || 0}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex gap-1">
                                {q.status === 'running' && !q.is_paused && (
                                  <SmallBtn onClick={() => handlePauseQueue(q.Id)} variant="secondary">
                                    Pausar
                                  </SmallBtn>
                                )}
                                {q.is_paused && (
                                  <SmallBtn onClick={() => handleResumeQueue(q.Id)} variant="secondary">
                                    Retomar
                                  </SmallBtn>
                                )}
                                <SmallBtn onClick={() => handleDeleteQueue(q.Id)} variant="destructive">
                                  Excluir
                                </SmallBtn>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!queueRows.length && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
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

          <div className="mt-6 text-xs text-muted-foreground">{status}</div>
        </div>
      </div>
    </div>
  );
};

export default Index;
