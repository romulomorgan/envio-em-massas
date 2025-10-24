import React, { useState } from 'react';
import { supaUpload, supaRemove } from '@/lib/supabase-client';
import { Block } from '@/types/envio';
import { uid } from '@/lib/utils-envio';

interface FileUploadProps {
  blk?: Block;
  accept: string;
  onUploaded?: (info: { url: string; name: string; type: string; path: string | null }) => void;
  onUploadComplete?: (url: string) => void;
  onError?: (msg: string) => void;
}

export function FileUpload({ blk, accept, onUploaded, onUploadComplete, onError }: FileUploadProps) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const inputId = `file-input-${blk?.id || uid()}`;

  async function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setStatus('Enviando...');

    try {
      if (blk?.data?._supaPath) {
        await supaRemove(blk.data._supaPath);
      }

      const info = await supaUpload(file, blk?.type || 'media');
      setStatus('Enviado');
      if (onUploaded) {
        onUploaded({
          url: info.url,
          name: info.name || file.name,
          type: info.type || file.type,
          path: info.path || null
        });
      }
      if (onUploadComplete) {
        onUploadComplete(info.url);
      }
    } catch (err: any) {
      console.error(err);
      const msg = 'Erro no upload: ' + (err?.message || 'falha');
      setStatus(msg);
      if (onError) onError(msg);
    } finally {
      setBusy(false);
      if (e && e.target) e.target.value = '';
    }
  }

  return (
    <div className="mb-3">
      <input
        type="file"
        accept={accept}
        className="hidden"
        id={inputId}
        onChange={handleSelect}
        disabled={busy}
      />
      <label
        htmlFor={inputId}
        className={`btn-custom ${busy ? 'btn-ghost-custom' : 'btn-primary-custom'}`}
        style={{ cursor: busy ? 'not-allowed' : 'pointer' }}
      >
        {busy ? 'Processando...' : 'Selecionar arquivo'}
      </label>
      {status && <div className="text-xs text-muted-foreground mt-1">{status}</div>}
    </div>
  );
}
