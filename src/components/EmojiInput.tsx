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

  const insertEmoji = (emoji: string) => {
    const input = inputRef.current;
    if (!input) return;

    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const newValue = value.substring(0, start) + emoji + value.substring(end);

    onChange(newValue);

    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        className="input-custom pr-10"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg bg-secondary hover:bg-accent border border-border flex items-center justify-center text-base transition-colors"
        onClick={() => setShowPicker(!showPicker)}
        title="Adicionar emoji"
      >
        😀
      </button>

      {showPicker && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowPicker(false)}
          />
          <div className="absolute right-0 top-full mt-2 z-50 bg-card border border-border rounded-xl shadow-lg p-3 w-72 max-h-60 overflow-y-auto">
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
