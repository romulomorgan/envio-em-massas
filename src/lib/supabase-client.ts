import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_BUCKET } from './config';

// Normaliza e mascara valores para logs seguros
function safeVal(v: any) { return String(v || '').trim(); }
function mask(v: string, show = 4) {
  const s = String(v || '');
  if (!s) return '';
  return `${s.slice(0, show)}…${s.slice(-show)}`;
}

// Permite override via window.__* mantendo valores fixos como fallback
const SB_URL = (typeof window !== 'undefined' && (window as any).__SUPABASE_URL__)
  ? safeVal((window as any).__SUPABASE_URL__)
  : safeVal(SUPABASE_URL);
const SB_KEY = (typeof window !== 'undefined' && (window as any).__SUPABASE_ANON_KEY__)
  ? safeVal((window as any).__SUPABASE_ANON_KEY__)
  : safeVal(SUPABASE_ANON_KEY);
export const SB_BUCKET = (typeof window !== 'undefined' && (window as any).__SUPABASE_BUCKET__)
  ? safeVal((window as any).__SUPABASE_BUCKET__)
  : safeVal(SUPABASE_BUCKET);

export const supabase = createClient(SB_URL, SB_KEY);

function mediaFolder(type: string) {
  const t = String(type || '').toLowerCase();
  if (t.startsWith('image')) return 'images';
  if (t.startsWith('video')) return 'videos';
  if (t.startsWith('audio')) return 'audios';
  if (t.startsWith('document') || t.startsWith('application')) return 'documents';
  return 'uploads';
}

export async function supaUpload(file: File, blockType: string) {
  try {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const folder = mediaFolder(blockType || file.type);
    const fileName = `${folder}/${blockType || 'media'}_${timestamp}_${randomSuffix}.${ext}`;

    console.log('[supaUpload] Iniciando upload:', { 
      fileName, fileType: file.type, blockType,
      url: SB_URL, bucket: SB_BUCKET, key: mask(SB_KEY)
    });

    const { data, error } = await supabase.storage
      .from(SB_BUCKET)
      .upload(fileName, file, { 
        cacheControl: '3600', 
        upsert: false,
        contentType: file.type || 'application/octet-stream'
      });

    if (error) {
      console.error('[supaUpload] Erro no upload:', {
        message: error.message,
        name: (error as any)?.name,
        statusCode: (error as any)?.statusCode,
        bucket: SB_BUCKET
      });
      throw new Error(error.message || 'Falha no upload');
    }

    console.log('[supaUpload] Upload bem-sucedido:', data);

    const { data: urlData } = supabase.storage
      .from(SB_BUCKET)
      .getPublicUrl(fileName);

    const result = {
      url: urlData.publicUrl,
      name: file.name,
      type: file.type,
      path: fileName
    };

    console.log('[supaUpload] Retornando dados:', result);
    return result;
  } catch (err) {
    console.error('[supaUpload] Erro crítico:', err);
    throw err;
  }
}

// Healthcheck simples para diagnosticar credenciais/bucket
export async function supaHealthcheck() {
  try {
    const res = await supabase.storage.from(SB_BUCKET).list('', { limit: 1, offset: 0 });
    return {
      ok: !res.error,
      dataCount: Array.isArray(res.data) ? res.data.length : 0,
      error: res.error ? {
        message: res.error.message,
        name: (res.error as any)?.name,
        statusCode: (res.error as any)?.statusCode,
      } : null,
      env: { url: SB_URL, bucket: SB_BUCKET }
    };
  } catch (e: any) {
    return { ok: false, error: { message: e?.message || String(e) }, env: { url: SB_URL, bucket: SB_BUCKET } };
  }
}

export async function supaRemove(path: string) {
  if (!path) return;
  const { error } = await supabase.storage.from(SB_BUCKET).remove([path]);
  if (error) console.error('Erro ao remover arquivo:', error);
}

