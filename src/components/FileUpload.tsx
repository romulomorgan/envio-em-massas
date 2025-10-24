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
  onRemoved?: () => void;
}

export function FileUpload({ blk, accept, onUploaded, onUploadComplete, onError, onRemoved }: FileUploadProps) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const inputId = `file-input-${blk?.id || uid()}`;

  // Verifica se já tem arquivo upado
  const hasFile = blk?.data?.url && blk.data.url.startsWith('http');
  const fileUrl = blk?.data?.url || '';

  async function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setStatus('Enviando...');

    try {
      // Remove arquivo antigo do Supabase se existir
      if (blk?.data?._supaPath) {
        await supaRemove(blk.data._supaPath).catch(console.error);
      }

      // Faz upload do novo arquivo
      const info = await supaUpload(file, blk?.type || 'media');
      setStatus('✅ Arquivo enviado com sucesso!');
      
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
      console.error('[FileUpload] Erro:', err);
      const msg = 'Erro no upload: ' + (err?.message || 'falha desconhecida');
      setStatus(msg);
      if (onError) onError(msg);
    } finally {
      setBusy(false);
      if (e && e.target) e.target.value = '';
    }
  }

  async function handleRemove() {
    if (!blk?.data?._supaPath) return;
    setBusy(true);
    try {
      await supaRemove(blk.data._supaPath);
      setStatus('Arquivo removido');
      if (onUploaded) {
        onUploaded({ url: '', name: '', type: '', path: null });
      }
      if (onRemoved) {
        onRemoved();
      }
    } catch (err: any) {
      console.error('[FileUpload] Erro ao remover:', err);
      setStatus('Erro ao remover arquivo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
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
          className={`btn-custom ${busy ? 'opacity-50 cursor-not-allowed' : 'btn-secondary-custom cursor-pointer'} inline-block`}
        >
          {busy ? '📤 Processando...' : hasFile ? '🔄 Trocar arquivo' : '📁 Selecionar arquivo'}
        </label>
        {hasFile && !busy && (
          <button
            className="btn-custom btn-destructive-custom"
            onClick={handleRemove}
            type="button"
          >
            🗑️ Remover
          </button>
        )}
      </div>
      
      {status && (
        <div className={`text-xs ${status.includes('sucesso') || status.includes('✅') ? 'text-green-600' : status.includes('Erro') || status.includes('❌') ? 'text-red-600' : 'text-muted-foreground'}`}>
          {status}
        </div>
      )}
      
      {hasFile && (
        <div className="mt-2 p-2 bg-muted rounded border border-border">
          <div className="text-xs text-muted-foreground mb-1">Arquivo atual:</div>
          <div className="text-sm font-mono break-all">{blk?.data?._file?.name || 'arquivo'}</div>
          <a 
            href={fileUrl} 
            target="_blank" 
            rel="noreferrer" 
            className="text-xs text-blue-600 hover:underline mt-1 inline-block"
          >
            🔗 Ver arquivo
          </a>
        </div>
      )}
    </div>
  );
}
