import React from 'react';
import { Block } from '@/types/envio';
import { todayDDMMYYYY, inferFilename } from '@/lib/utils-envio';

interface WAPreviewProps {
  blocks: Block[];
  sampleName: string;
}

function resolvePreviewTokens(text: string, name: string): string {
  return text
    .replace(/\{\{\s*nome\s*\}\}/gi, name)
    .replace(/\{\{\s*data\s*\}\}/gi, todayDDMMYYYY());
}

function WABubble({ children }: { children: React.ReactNode }) {
  return <div className="wa-bubble shadow-sm">{children}</div>;
}

export function WAPreview({ blocks, sampleName }: WAPreviewProps) {
  return (
    <div className="wa-phone w-full max-w-sm mx-auto">
      <div className="wa-header">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
          👤
        </div>
        <div className="font-semibold">Contato</div>
        <div className="ml-auto text-sm opacity-80">online</div>
      </div>

      <div className="wa-chat">
        <div className="flex flex-col gap-2">
          {blocks.map((blk) => {
            const d = blk.data || {};

            if (blk.type === 'text') {
              return (
                <div key={blk.id} className="flex justify-end">
                  <WABubble>
                    <div style={{ whiteSpace: 'pre-wrap' }}>
                      {resolvePreviewTokens(d.text || ' ', sampleName)}
                    </div>
                  </WABubble>
                </div>
              );
            }

            if (blk.type === 'image') {
              return (
                <div key={blk.id} className="flex justify-end">
                  <WABubble>
                    <img
                      src={d.url || ''}
                      alt=""
                      className="rounded-md max-h-72 object-contain"
                    />
                    {d.caption && (
                      <div className="mt-1.5 text-sm whitespace-pre-wrap">
                        {resolvePreviewTokens(d.caption, sampleName)}
                      </div>
                    )}
                  </WABubble>
                </div>
              );
            }

            if (blk.type === 'video') {
              return (
                <div key={blk.id} className="flex justify-end">
                  <WABubble>
                    <video
                      src={d.url || ''}
                      controls
                      className="rounded-md max-h-72 w-full"
                    />
                    {d.caption && (
                      <div className="mt-1.5 text-sm whitespace-pre-wrap">
                        {resolvePreviewTokens(d.caption, sampleName)}
                      </div>
                    )}
                  </WABubble>
                </div>
              );
            }

            if (blk.type === 'audio') {
              return (
                <div key={blk.id} className="flex justify-end">
                  <WABubble>
                    <audio controls src={d.url || ''} style={{ width: '260px' }} />
                  </WABubble>
                </div>
              );
            }

            if (blk.type === 'document') {
              const name = resolvePreviewTokens(
                d.filename || inferFilename(d.url || '', 'Documento'),
                sampleName
              );
              return (
                <div key={blk.id} className="flex justify-end">
                  <WABubble>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="w-8 h-10 bg-gray-200 rounded flex items-center justify-center">
                        📄
                      </div>
                      <div>
                        <div className="font-semibold text-sm">{name}</div>
                        <a
                          className="text-blue-600 underline text-xs"
                          href={d.url || '#'}
                          target="_blank"
                          rel="noreferrer"
                        >
                          abrir
                        </a>
                      </div>
                    </div>
                    {d.caption && (
                      <div className="mt-1.5 text-sm text-slate-600 whitespace-pre-wrap">
                        {resolvePreviewTokens(d.caption, sampleName)}
                      </div>
                    )}
                  </WABubble>
                </div>
              );
            }

            if (blk.type === 'link') {
              const title = resolvePreviewTokens(d.title || '', sampleName);
              const desc = resolvePreviewTokens(d.description || '', sampleName);
              return (
                <div key={blk.id} className="flex justify-end">
                  <WABubble>
                    <div className="font-semibold">{title}</div>
                    {desc && <div className="text-sm text-slate-600 mt-1">{desc}</div>}
                    {d.url && (
                      <a
                        className="text-blue-600 underline text-sm mt-1 block"
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {d.url}
                      </a>
                    )}
                  </WABubble>
                </div>
              );
            }

            if (blk.type === 'list') {
              const title = resolvePreviewTokens(d.title || 'Menu', sampleName);
              const desc = resolvePreviewTokens(d.description || '', sampleName);
              const btn = resolvePreviewTokens(d.buttonText || 'Abrir', sampleName);
              const foot = resolvePreviewTokens(d.footer || '', sampleName);
              return (
                <div key={blk.id} className="flex justify-end">
                  <WABubble>
                    <div className="font-semibold">{title}</div>
                    {desc && <div className="text-sm text-slate-600 mt-1">{desc}</div>}
                    <div className="mt-2 px-2.5 py-2 rounded-lg bg-slate-200 inline-block font-bold text-sm">
                      {btn}
                    </div>
                    {foot && (
                      <div className="text-sm text-slate-500 mt-2">{foot}</div>
                    )}
                  </WABubble>
                </div>
              );
            }

            if (blk.type === 'poll') {
              const name = resolvePreviewTokens(d.name || 'Enquete', sampleName);
              const values = (d.values || []).slice(0, 12);
              return (
                <div key={blk.id} className="flex justify-end">
                  <WABubble>
                    <div className="font-semibold">{name}</div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {values.map((v, i) => (
                        <span
                          key={i}
                          className="px-2.5 py-1.5 rounded-full bg-slate-200 text-xs border border-slate-300"
                        >
                          {resolvePreviewTokens(v, sampleName)}
                        </span>
                      ))}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Seleções: {Math.max(1, d.selectableCount || 1)}
                    </div>
                  </WABubble>
                </div>
              );
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
}
