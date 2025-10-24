import React, { useState, useRef } from 'react';

interface EmojiTextareaProps {
  value: string;
  onChange: (value: string) => void;
  minHeight?: number;
  placeholder?: string;
}

export function EmojiTextarea({ value, onChange, minHeight = 120, placeholder }: EmojiTextareaProps) {
  const [showPicker, setShowPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const emojis = [
    '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘',
    '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒',
    '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡',
    '👍', '👎', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻',
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💔', '❣️', '💕', '💞', '💓', '💗', '💖',
    '⭐', '🌟', '✨', '💫', '🔥', '💥', '⚡', '☀️', '🌙', '⭐', '🌈', '☁️', '⛅', '🌤️', '⛈️', '🌧️'
  ];

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue = value.substring(0, start) + emoji + value.substring(end);

    onChange(newValue);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        className="input-custom resize-none"
        style={{ minHeight }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <button
        type="button"
        className="absolute right-2 top-2 w-8 h-8 rounded-lg bg-secondary hover:bg-accent border border-border flex items-center justify-center text-lg transition-colors"
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
