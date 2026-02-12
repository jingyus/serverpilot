// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export interface ServerSelectorProps {
  servers: Array<{ id: string; name: string; status: string }>;
  navigate: (path: string) => void;
}

export function ServerSelector({ servers, navigate }: ServerSelectorProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 sm:space-y-6" data-testid="server-selector">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">{t('nav.aiChat')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('chat.selectServer')}
        </p>
      </div>

      {servers.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {t('chat.noServers')}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => (
            <Card
              key={server.id}
              className="cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => navigate(`/chat/${server.id}`)}
              data-testid={`server-card-${server.id}`}
            >
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Server className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">{server.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {server.status}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
