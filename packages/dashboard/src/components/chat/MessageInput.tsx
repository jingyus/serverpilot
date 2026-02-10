import { useState, useRef, useCallback } from 'react';
import { Send, Square, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MAX_MESSAGE_LENGTH } from '@/types/chat';

interface MessageInputProps {
  onSend: (message: string) => void;
  onCancel: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

export function MessageInput({
  onSend,
  onCancel,
  isStreaming,
  disabled = false,
}: MessageInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = input.trim();
  const charCount = trimmed.length;
  const isOverLimit = charCount > MAX_MESSAGE_LENGTH;
  const canSend = charCount > 0 && !isOverLimit && !isStreaming && !disabled;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(trimmed);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [canSend, trimmed, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    },
    []
  );

  return (
    <div
      className="border-t bg-background px-2 py-2 sm:px-4 sm:py-3"
      data-testid="message-input"
    >
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            disabled={disabled}
            rows={1}
            className={cn(
              'w-full resize-none rounded-lg border bg-background px-3 py-2.5 pr-14 text-sm sm:px-4 sm:py-3 sm:pr-16',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
              isOverLimit && 'border-destructive focus:ring-destructive',
              disabled && 'cursor-not-allowed opacity-50'
            )}
            data-testid="message-textarea"
          />
          {charCount > 0 && (
            <span
              className={cn(
                'absolute bottom-2 right-3 text-xs',
                isOverLimit ? 'text-destructive' : 'text-muted-foreground'
              )}
              data-testid="char-count"
            >
              {charCount}/{MAX_MESSAGE_LENGTH}
            </span>
          )}
        </div>

        {isStreaming ? (
          <Button
            variant="destructive"
            size="icon"
            onClick={onCancel}
            className="shrink-0"
            data-testid="cancel-btn"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!canSend}
            className="shrink-0"
            data-testid="send-btn"
          >
            {disabled ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
