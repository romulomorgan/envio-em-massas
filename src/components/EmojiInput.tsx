import React, { useState, useRef } from 'react';

interface EmojiInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function EmojiInput({ value, onChange, placeholder }: EmojiInputProps) {
  const [showPicker, setShowPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const emojis = [
    '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘',
    '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒',
    '👍', '👎', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '❤️', '🧡', '💛', '💚', '💙', '💜',
    '⭐', '🌟', '✨', '💫', '🔥', '💥', '⚡', '☀️', '🌙', '🌈', '☁️'
  ];

  const insertText = (text: string) => {
    const input = inputRef.current;
    if (!input) return;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const newValue = value.substring(0, start) + text + value.substring(end);
    onChange(newValue);
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + text.length, start + text.length);
    }, 0);
  };

  const insertEmoji = (emoji: string) => insertText(emoji);

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="text"
        className="input-custom"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="w-8 h-8 rounded-lg bg-secondary hover:bg-accent border border-border flex items-center justify-center text-base transition-colors"
          onClick={() => setShowPicker(!showPicker)}
          title="Adicionar emoji"
        >
          😀
        </button>
        <button
          type="button"
          className="px-3 h-8 rounded-lg bg-secondary hover:bg-accent border border-border text-xs font-mono"
          onClick={() => insertText('{{nome}}')}
          title="Inserir {{nome}}"
        >
          {"{{nome}}"}
        </button>
        <button
          type="button"
          className="px-3 h-8 rounded-lg bg-secondary hover:bg-accent border border-border text-xs font-mono"
          onClick={() => insertText('{{data}}')}
          title="Inserir {{data}}"
        >
          {"{{data}}"}
        </button>
      </div>

      {showPicker && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowPicker(false)}
          />
          <div className="absolute left-0 top-full mt-2 z-50 bg-card border border-border rounded-xl shadow-lg p-3 w-72 max-h-60 overflow-y-auto">
            <div className="grid grid-cols-8 gap-1">
              {emojis.map((emoji, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="w-8 h-8 flex items-center justify-center hover:bg-accent rounded text-xl transition-colors"
                  onClick={() => {
                    insertEmoji(emoji);
                    setShowPicker(false);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
