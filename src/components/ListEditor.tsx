import React from 'react';
import { Field } from './Field';
import { EmojiInput } from './EmojiInput';
import { EmojiTextarea } from './EmojiTextarea';
import { SmallBtn } from './SmallBtn';
import { uid } from '@/lib/utils-envio';
import { BlockData } from '@/types/envio';

interface ListEditorProps {
  data: BlockData;
  onChange: (data: BlockData) => void;
}

export function ListEditor({ data, onChange }: ListEditorProps) {
  const sections = data.sections || [];

  const addSection = () => {
    onChange({
      ...data,
      sections: [...sections, { title: 'Nova seção', rows: [] }]
    });
  };

  const updateSection = (index: number, updates: Partial<typeof sections[0]>) => {
    const newSections = [...sections];
    newSections[index] = { ...newSections[index], ...updates };
    onChange({ ...data, sections: newSections });
  };

  const removeSection = (index: number) => {
    onChange({ ...data, sections: sections.filter((_, i) => i !== index) });
  };

  const addRow = (sectionIndex: number) => {
    const newSections = [...sections];
    newSections[sectionIndex].rows.push({
      rowId: uid(),
      title: 'Nova opção',
      description: ''
    });
    onChange({ ...data, sections: newSections });
  };

  const updateRow = (
    sectionIndex: number,
    rowIndex: number,
    updates: Partial<typeof sections[0]['rows'][0]>
  ) => {
    const newSections = [...sections];
    newSections[sectionIndex].rows[rowIndex] = {
      ...newSections[sectionIndex].rows[rowIndex],
      ...updates
    };
    onChange({ ...data, sections: newSections });
  };

  const removeRow = (sectionIndex: number, rowIndex: number) => {
    const newSections = [...sections];
    newSections[sectionIndex].rows = newSections[sectionIndex].rows.filter(
      (_, i) => i !== rowIndex
    );
    onChange({ ...data, sections: newSections });
  };

  return (
    <div className="space-y-3">
      <Field label="Título">
        <EmojiInput
          value={data.title || ''}
          onChange={(v) => onChange({ ...data, title: v })}
        />
      </Field>

      <Field label="Descrição (opcional)">
        <EmojiTextarea
          value={data.description || ''}
          onChange={(v) => onChange({ ...data, description: v })}
          minHeight={80}
        />
      </Field>

      <Field label="Texto do botão">
        <EmojiInput
          value={data.buttonText || ''}
          onChange={(v) => onChange({ ...data, buttonText: v })}
        />
      </Field>

      <Field label="Rodapé (opcional)">
        <EmojiInput
          value={data.footer || ''}
          onChange={(v) => onChange({ ...data, footer: v })}
        />
      </Field>

      <div className="border-t pt-3 mt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold text-sm">Seções</div>
          <button
            type="button"
            className="btn-ghost-custom text-xs"
            onClick={addSection}
          >
            + Adicionar seção
          </button>
        </div>

        {sections.map((section, sIdx) => (
          <details key={sIdx} open className="mb-3 border rounded-lg p-2">
            <summary className="cursor-pointer font-semibold text-sm mb-2 list-none flex items-center justify-between">
              <span>Seção {sIdx + 1}: {section.title || '(sem título)'}</span>
              <SmallBtn onClick={() => removeSection(sIdx)} title="Remover seção">
                ✖
              </SmallBtn>
            </summary>

            <Field label="Título da seção">
              <input
                className="input-custom"
                value={section.title}
                onChange={(e) => updateSection(sIdx, { title: e.target.value })}
              />
            </Field>

            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-semibold">Linhas</div>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => addRow(sIdx)}
                >
                  + Adicionar linha
                </button>
              </div>

              {section.rows.map((row, rIdx) => (
                <div key={rIdx} className="border rounded p-2 mb-2 bg-slate-50">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-semibold">Linha {rIdx + 1}</div>
                    <SmallBtn
                      onClick={() => removeRow(sIdx, rIdx)}
                      title="Remover linha"
                    >
                      ✖
                    </SmallBtn>
                  </div>
                  <input
                    className="input-custom text-sm mb-1"
                    placeholder="Título da linha"
                    value={row.title}
                    onChange={(e) => updateRow(sIdx, rIdx, { title: e.target.value })}
                  />
                  <input
                    className="input-custom text-sm"
                    placeholder="Descrição (opcional)"
                    value={row.description || ''}
                    onChange={(e) =>
                      updateRow(sIdx, rIdx, { description: e.target.value })
                    }
                  />
                </div>
              ))}

              {section.rows.length === 0 && (
                <div className="text-xs text-muted-foreground italic">
                  Nenhuma linha. Adicione acima.
                </div>
              )}
            </div>
          </details>
        ))}

        {sections.length === 0 && (
          <div className="text-sm text-muted-foreground italic">
            Nenhuma seção. Adicione acima.
          </div>
        )}
      </div>
    </div>
  );
}
