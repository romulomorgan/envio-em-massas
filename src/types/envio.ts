export interface Contact {
  id: string;
  name: string;
  phone: string;
  tags: string;
  srcImported?: boolean;
  srcLabel?: boolean;
  srcEmp?: boolean;
  srcGroup?: boolean;
}

export interface Label {
  id: string | number;
  title: string;
  name?: string;
  color?: string;
}

export interface Group {
  id: string;
  name: string;
  subject?: string;
}

export interface Empreendimento {
  id: string | number;
  title: string;
  name?: string;
  codigo?: string;
}

export interface Profile {
  Id: string | number;
  name: string;
  origin?: string;
  chatwoot_origin?: string;
  account_id?: string | number;
  inbox_id?: string | number;
  admin_apikey?: string;
}

export interface BlockData {
  text?: string;
  url?: string;
  caption?: string;
  filename?: string;
  title?: string;
  description?: string;
  buttonText?: string;
  footer?: string;
  sections?: Array<{
    title: string;
    rows: Array<{
      rowId?: string;
      id?: string;
      title: string;
      description?: string;
    }>;
  }>;
  name?: string;
  values?: string[];
  selectableCount?: number;
  _file?: { name: string; type: string };
  _supaPath?: string | null;
}

export interface Block {
  id: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'link' | 'list' | 'poll';
  action: string;
  data: BlockData;
  itemWait: number;
}

export interface QueueRecord {
  Id: string | number;
  name: string;
  status: string;
  scheduled_for: string;
  items_count: number;
  contacts_count: number;
  progress_contact_ix?: number;
  run_id?: string;
  is_paused?: boolean;
  account_id?: string | number;
  chatwoot_origin?: string;
}

export interface TenantConfig {
  id: string;
  chatwoot_origin: string;
  account_id: string;
  is_active: boolean;
  cv_activa: boolean;
  cv_active?: boolean;
  admin_apikey: string;
  cv_email: string;
  cv_apikey: string;
  default: boolean;
}
