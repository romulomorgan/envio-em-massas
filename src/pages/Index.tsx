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
  const __forcedOrigin = (typeof window !== 'undefined' && (window as any).__FORCE_ORIGIN__) || origin;
  const originNo = normalizeOrigin(__forcedOrigin);
  const originCanon = canonOrigin(originNo);

  // IDs (simplificado - sem roteamento complexo do Chatwoot)
  const [accountId, setAccountId] = useState('');
  const [inboxId, setInboxId] = useState('');

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
  const [itemDelay, setItemDelay] = useState(1);
  const [itemVariance, setItemVariance] = useState(0);
  const [contactDelay, setContactDelay] = useState(5);
  const [contactVariance, setContactVariance] = useState(2);

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

  // Carregar configuração do tenant
  async function loadTenantConfig() {
    try {
      const baseUrl = NOCO_URL;
      const originA = originCanon;
      const originB = originNo;

      let data: any = null;

      if (accountId) {
        const whereA = `(account_id,eq,${accountId})~and(chatwoot_origin,eq,${originA})`;
        const urlA = `${baseUrl}/api/v2/tables/${NOCO_TENANT_TABLE_ID}/records?offset=0&limit=25&viewId=${NOCO_TENANT_VIEW_ID}&where=${encodeURIComponent(whereA)}`;
        data = await nocoGET(urlA).catch(() => null);

        if (!data || !Array.isArray(data.list) || data.list.length === 0) {
          const whereB = `(account_id,eq,${accountId})~and(chatwoot_origin,eq,${originB})`;
          const urlB = `${baseUrl}/api/v2/tables/${NOCO_TENANT_TABLE_ID}/records?offset=0&limit=25&viewId=${NOCO_TENANT_VIEW_ID}&where=${encodeURIComponent(whereB)}`;
          data = await nocoGET(urlB).catch(() => null);
        }
      } else {
        const whereA = `(chatwoot_origin,eq,${originA})`;
        const urlA = `${baseUrl}/api/v2/tables/${NOCO_TENANT_TABLE_ID}/records?offset=0&limit=25&viewId=${NOCO_TENANT_VIEW_ID}&where=${encodeURIComponent(whereA)}`;
        data = await nocoGET(urlA).catch(() => null);

        if (!data || !Array.isArray(data.list) || data.list.length === 0) {
          const whereB = `(chatwoot_origin,eq,${originB})`;
          const urlB = `${baseUrl}/api/v2/tables/${NOCO_TENANT_TABLE_ID}/records?offset=0&limit=25&viewId=${NOCO_TENANT_VIEW_ID}&where=${encodeURIComponent(whereB)}`;
          data = await nocoGET(urlB).catch(() => null);
        }
      }

      const list = (Array.isArray(data?.list) ? data.list : [])
        .map((r: any) => ({
          id: String(r.Id ?? r.id ?? ''),
          chatwoot_origin: (r.chatwoot_origin || '').trim(),
          account_id: String(r.account_id ?? ''),
          is_active: !!(r.is_active === true || r.is_active === 'true' || r.is_active === 1),
          cv_activa: !!(r.cv_activa === true || r.cv_activa === 'true' || r.cv_activa === 1 || r.cv_active === true || r.cv_active === 'true' || r.cv_active === 1),
          admin_apikey: r.admin_apikey || r.adimin_apikey || '',
          cv_email: r.cv_email || '',
          cv_apikey: r.cv_apikey || '',
          default: !!r.default
        }))
        .filter((r: any) => canonOrigin(r.chatwoot_origin) === originCanon && (!accountId || String(r.account_id) === String(accountId)));

      if (!list.length) {
        setTenantConfig(null);
        setHasChatwootAccess(false);
        setHasCvAccess(false);
        return null;
      }

      const chosen = list.find((x: any) => x.default) || list[0];
      if (!accountId && chosen && chosen.account_id) {
        setAccountId(String(chosen.account_id));
      }
      setTenantConfig(chosen);
      setHasChatwootAccess(!!(chosen.admin_apikey) && chosen.is_active === true);
      setHasCvAccess(chosen.cv_activa || chosen.cv_active);
      return chosen;
    } catch (e) {
      console.error('loadTenantConfig error:', e);
      setTenantConfig(null);
      setHasChatwootAccess(false);
      setHasCvAccess(false);
      return null;
    }
  }

  useEffect(() => {
    loadTenantConfig();
  }, []);

  // Carregar perfis
  async function loadProfiles() {
    setLoadingProfiles(true);
    setProfilesError('');
    try {
      const where = `(origin,eq,${originCanon})~and(account_id,eq,${accountId})`;
      const url = `${NOCO_URL}/api/v2/tables/${NOCO_TABLE_PROFILES_ID}/records?where=${encodeURIComponent(where)}&limit=1000`;
      const data = await nocoGET(url);
      const list = Array.isArray(data?.list) ? data.list : [];
      setProfiles(list.map((r: any) => ({
        Id: r.Id,
        name: r.name || r.profile_name || 'Perfil',
        origin: r.origin,
        account_id: r.account_id,
        inbox_id: r.inbox_id
      })));
      setStatus(`${list.length} perfil(is) carregado(s).`);
    } catch (err: any) {
      console.error('Erro ao carregar perfis:', err);
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

  // Placeholder para funções complexas (continuação necessária)
  // ...

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="card-custom p-6 md:p-8">
          <h1 className="text-3xl font-bold mb-2">Envio em Massa</h1>
          
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

          {/* Conteúdo das tabs */}
          {tab === 'direct' && (
            <div className="space-y-6">
              <SectionTitle>Perfil</SectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              <div className="h-px bg-border my-6" />
              
              <SectionTitle>Contatos</SectionTitle>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
                <p className="text-sm text-blue-800">
                  ⚙️ <strong>Sistema em implementação</strong> - As funcionalidades completas estão sendo migradas do HTML original.
                  <br />
                  Componentes implementados: design system, preview WhatsApp, estrutura de tabs, tipos e configurações.
                </p>
              </div>

              <div className="text-muted-foreground text-sm">
                Total de contatos: {contacts.length} • Selecionados: {selectedContacts.length}
              </div>
            </div>
          )}

          {tab === 'monitor' && (
            <div className="space-y-6">
              <SectionTitle>
                <span>Acompanhar envios</span>
              </SectionTitle>
              <div className="text-muted-foreground text-sm">
                Monitor de campanhas em implementação...
              </div>
            </div>
          )}

          <div className="mt-6 text-xs text-muted-foreground">{status}</div>
        </div>
      </div>
    </div>
  );
};

export default Index;
