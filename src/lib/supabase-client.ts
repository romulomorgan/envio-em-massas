import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_BUCKET } from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function supaUpload(file: File, blockType: string) {
  const ext = file.name.split('.').pop() || 'bin';
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const fileName = `${blockType}_${timestamp}_${randomSuffix}.${ext}`;
  const filePath = `uploads/${fileName}`;

  const { data, error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(filePath, file, { cacheControl: '3600', upsert: false });

  if (error) throw error;

  const { data: urlData } = supabase.storage
    .from(SUPABASE_BUCKET)
    .getPublicUrl(filePath);

  return {
    url: urlData.publicUrl,
    name: file.name,
    type: file.type,
    path: filePath
  };
}

export async function supaRemove(path: string) {
  if (!path) return;
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove([path]);
  if (error) console.error('Erro ao remover arquivo:', error);
}
