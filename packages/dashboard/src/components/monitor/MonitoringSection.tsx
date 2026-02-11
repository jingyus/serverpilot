// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useCallback } from 'react';
import { Cpu, MemoryStick, HardDrive, Network } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MetricsChart } from './MetricsChart';
import type { MetricPoint, MetricsRange } from '@/types/server';

interface MonitoringSectionProps {
  metricsHistory: MetricPoint[];
  metricsRange: MetricsRange;
  serverId: string;
  onRangeChange: (range: MetricsRange) => void;
}

const RANGE_OPTIONS: { value: MetricsRange; label: string }[] = [
  { value: '1h', label: '1 Hour' },
  { value: '24h', label: '24 Hours' },
  { value: '7d', label: '7 Days' },
];

const CHART_CONFIGS = [
  { type: 'cpu' as const, label: 'CPU Usage', icon: Cpu },
  { type: 'memory' as const, label: 'Memory Usage', icon: MemoryStick },
  { type: 'disk' as const, label: 'Disk Usage', icon: HardDrive },
  { type: 'network' as const, label: 'Network I/O', icon: Network },
];

export function MonitoringSection({
  metricsHistory,
  metricsRange,
  onRangeChange,
}: MonitoringSectionProps) {
  const handleRangeChange = useCallback(
    (range: MetricsRange) => {
      onRangeChange(range);
    },
    [onRangeChange],
  );

  return (
    <div className="space-y-4" data-testid="monitoring-section">
      {/* Range selector */}
      <div className="flex gap-2" data-testid="range-selector">
        {RANGE_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={metricsRange === opt.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleRangeChange(opt.value)}
            data-testid={`range-${opt.value}`}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {CHART_CONFIGS.map(({ type, label, icon: Icon }) => (
          <Card key={type}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Icon className="h-4 w-4" />
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <MetricsChart data={metricsHistory} type={type} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
