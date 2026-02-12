// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import type { AgenticConfirm } from '@/stores/chat';

interface AgenticConfirmBarProps {
  confirm: AgenticConfirm;
  onApprove: () => void;
  onReject: () => void;
}

const RISK_COLORS: Record<string, string> = {
  yellow: 'bg-yellow-100 border-yellow-400 text-yellow-800',
  red: 'bg-orange-100 border-orange-400 text-orange-800',
  critical: 'bg-red-100 border-red-400 text-red-800',
};

const RISK_LABELS: Record<string, string> = {
  yellow: 'YELLOW',
  red: 'RED',
  critical: 'CRITICAL',
};

export function AgenticConfirmBar({ confirm, onApprove, onReject }: AgenticConfirmBarProps) {
  const colorClass = RISK_COLORS[confirm.riskLevel] ?? RISK_COLORS.yellow;
  const label = RISK_LABELS[confirm.riskLevel] ?? confirm.riskLevel.toUpperCase();

  return (
    <div className={`border rounded-lg p-4 mx-4 mb-4 ${colorClass}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">&#9888;</span>
        <span className="font-semibold">
          {confirm.description}
        </span>
        <span className="text-xs font-mono px-2 py-0.5 rounded bg-white/50">
          {label}
        </span>
      </div>
      <div className="font-mono text-sm bg-white/30 rounded px-3 py-1.5 mb-3">
        $ {confirm.command}
      </div>
      <div className="flex gap-3">
        <button
          onClick={onApprove}
          className="px-4 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
        >
          Allow
        </button>
        <button
          onClick={onReject}
          className="px-4 py-1.5 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm font-medium"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
