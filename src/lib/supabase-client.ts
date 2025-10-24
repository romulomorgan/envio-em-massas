import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_BUCKET } from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function mediaFolder(type: string) {
  const t = String(type || '').toLowerCase();
  if (t.startsWith('image')) return 'images';
  if (t.startsWith('video')) return 'videos';
  if (t.startsWith('audio')) return 'audios';
  if (t.startsWith('document') || t.startsWith('application')) return 'documents';
  return 'uploads';
}

export async function supaUpload(file: File, blockType: string) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const folder = mediaFolder(blockType || file.type);
  const fileName = `${folder}/${blockType || 'media'}_${timestamp}_${randomSuffix}.${ext}`;

  const { data, error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(fileName, file, { cacheControl: '3600', upsert: false, contentType: file.type });

  if (error) {
    console.error('[supaUpload] Upload error:', error);
    throw new Error(error.message || 'Falha no upload');
  }

  const { data: urlData } = supabase.storage
    .from(SUPABASE_BUCKET)
    .getPublicUrl(fileName);

  return {
    url: urlData.publicUrl,
    name: file.name,
    type: file.type,
    path: fileName
  };
}

export async function supaRemove(path: string) {
  if (!path) return;
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove([path]);
  if (error) console.error('Erro ao remover arquivo:', error);
}

