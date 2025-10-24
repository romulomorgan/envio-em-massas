import React from 'react';
import { Field } from './Field';
import { EmojiInput } from './EmojiInput';
import { SmallBtn } from './SmallBtn';
import { BlockData } from '@/types/envio';

interface PollEditorProps {
  data: BlockData;
  onChange: (data: BlockData) => void;
}

export function PollEditor({ data, onChange }: PollEditorProps) {
  const values = data.values || [];
  const selectableCount = data.selectableCount || 1;

  const addOption = () => {
    if (values.length >= 12) {
      alert('Máximo de 12 opções atingido.');
      return;
    }
    onChange({ ...data, values: [...values, 'Nova opção'] });
  };

  const updateOption = (index: number, value: string) => {
    const newValues = [...values];
    newValues[index] = value;
    onChange({ ...data, values: newValues });
  };

  const removeOption = (index: number) => {
    onChange({ ...data, values: values.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      <Field label="Pergunta da enquete">
        <EmojiInput
          value={data.name || ''}
          onChange={(v) => onChange({ ...data, name: v })}
          placeholder="Ex: Qual sua cor favorita?"
        />
      </Field>

      <Field label="Número de seleções permitidas">
        <input
          type="number"
          min="1"
          max={values.length || 1}
          className="input-custom"
          value={selectableCount}
          onChange={(e) =>
            onChange({ ...data, selectableCount: Number(e.target.value) })
          }
        />
      </Field>

      <div className="border-t pt-3 mt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold text-sm">
            Opções ({values.length}/12)
          </div>
          <button
            type="button"
            className="btn-ghost-custom text-xs"
            onClick={addOption}
            disabled={values.length >= 12}
          >
            + Adicionar opção
          </button>
        </div>

        {values.map((val, idx) => (
          <div key={idx} className="flex items-center gap-2 mb-2">
            <input
              className="input-custom flex-1"
              value={val}
              onChange={(e) => updateOption(idx, e.target.value)}
              placeholder={`Opção ${idx + 1}`}
            />
            <SmallBtn onClick={() => removeOption(idx)} title="Remover opção">
              ✖
            </SmallBtn>
          </div>
        ))}

        {values.length === 0 && (
          <div className="text-sm text-muted-foreground italic">
            Adicione pelo menos 2 opções para a enquete.
          </div>
        )}

        {values.length === 1 && (
          <div className="text-sm text-yellow-600">
            Adicione mais uma opção (mínimo de 2 para enquetes).
          </div>
        )}
      </div>
    </div>
  );
}
