// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState } from 'react';
import { Copy, Check, Eye, EyeOff, Terminal } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface TokenDisplayProps {
  token: string;
  installCommand: string;
}

export function TokenDisplay({ token, installCommand }: TokenDisplayProps) {
  const [copiedField, setCopiedField] = useState<'command' | 'token' | null>(null);
  const [showToken, setShowToken] = useState(false);

  async function handleCopy(text: string, field: 'command' | 'token') {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  const maskedToken = token.slice(0, 8) + '*'.repeat(Math.max(0, token.length - 8));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Terminal className="h-4 w-4" />
          Install Command
        </div>
        <div className="rounded-lg bg-muted p-3">
          <code className="block break-all text-sm" data-testid="install-command">
            {installCommand}
          </code>
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => handleCopy(installCommand, 'command')}
          aria-label="Copy install command"
        >
          {copiedField === 'command' ? (
            <Check className="mr-2 h-4 w-4" />
          ) : (
            <Copy className="mr-2 h-4 w-4" />
          )}
          {copiedField === 'command' ? 'Copied!' : 'Copy Command'}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Agent Token</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowToken(!showToken)}
            aria-label={showToken ? 'Hide token' : 'Show token'}
          >
            {showToken ? (
              <EyeOff className="mr-1 h-3.5 w-3.5" />
            ) : (
              <Eye className="mr-1 h-3.5 w-3.5" />
            )}
            {showToken ? 'Hide' : 'Show'}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 rounded-lg bg-muted p-2 text-xs break-all"
            data-testid="agent-token"
          >
            {showToken ? token : maskedToken}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleCopy(token, 'token')}
            aria-label="Copy token"
          >
            {copiedField === 'token' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          This token is shown only once. Store it securely if needed.
        </p>
      </div>
    </div>
  );
}
