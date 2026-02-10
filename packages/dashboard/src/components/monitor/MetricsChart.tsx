import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

import { formatBytes } from '@/utils/format';
import type { MetricPoint } from '@/types/server';

interface MetricsChartProps {
  data: MetricPoint[];
  type: 'cpu' | 'memory' | 'disk' | 'network';
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function CpuChart({ data }: { data: MetricPoint[] }) {
  const chartData = data.map((p) => ({
    time: formatTime(p.timestamp),
    cpu: Number(p.cpuUsage.toFixed(1)),
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="time" className="text-xs" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(value) => [`${value}%`, 'CPU']}
          labelFormatter={(label) => `Time: ${label}`}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="cpu"
          name="CPU Usage"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function MemoryChart({ data }: { data: MetricPoint[] }) {
  const chartData = data.map((p) => ({
    time: formatTime(p.timestamp),
    used: Number(((p.memoryUsage / p.memoryTotal) * 100).toFixed(1)),
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="time" className="text-xs" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(value) => [`${value}%`, 'Memory']}
          labelFormatter={(label) => `Time: ${label}`}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="used"
          name="Memory Usage"
          stroke="#8b5cf6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function DiskChart({ data }: { data: MetricPoint[] }) {
  const chartData = data.map((p) => ({
    time: formatTime(p.timestamp),
    used: Number(((p.diskUsage / p.diskTotal) * 100).toFixed(1)),
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="time" className="text-xs" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(value) => [`${value}%`, 'Disk']}
          labelFormatter={(label) => `Time: ${label}`}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="used"
          name="Disk Usage"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function NetworkChart({ data }: { data: MetricPoint[] }) {
  const chartData = data.map((p) => ({
    time: formatTime(p.timestamp),
    in: p.networkIn,
    out: p.networkOut,
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="time" className="text-xs" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={(v) => formatBytes(v)} tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(value, name) => [
            `${formatBytes(Number(value))}/s`,
            name === 'in' ? 'Inbound' : 'Outbound',
          ]}
          labelFormatter={(label) => `Time: ${label}`}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="in"
          name="Inbound"
          stroke="#22c55e"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="out"
          name="Outbound"
          stroke="#ef4444"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

const CHART_MAP = {
  cpu: CpuChart,
  memory: MemoryChart,
  disk: DiskChart,
  network: NetworkChart,
} as const;

export function MetricsChart({ data, type }: MetricsChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center py-12 text-sm text-muted-foreground"
        data-testid={`chart-empty-${type}`}
      >
        No data available for this time range.
      </div>
    );
  }

  const Chart = CHART_MAP[type];
  return (
    <div data-testid={`chart-${type}`}>
      <Chart data={data} />
    </div>
  );
}
