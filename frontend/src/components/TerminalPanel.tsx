import { useMemo } from 'react';

interface TerminalPanelProps {
  lines: string[];
  onClear: () => void;
  title?: string;
}

export default function TerminalPanel({
  lines,
  onClear,
  title = 'TELEMETRY TERMINAL'
}: TerminalPanelProps) {
  const renderedText = useMemo(() => lines.join('\n'), [lines]);

  return (
    <div className="border border-orange-500/40 rounded-lg bg-black/40 backdrop-blur-sm h-[420px] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-orange-500/20">
        <div className="text-gray-400 text-xs tracking-widest">{title}</div>
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-semibold tracking-wider text-gray-400 hover:text-orange-500 transition-colors"
        >
          CLEAR
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs text-gray-200 space-y-1">
        {lines.length === 0 ? (
          <div className="text-gray-500">Waiting for telemetry stream...</div>
        ) : (
          <pre className="whitespace-pre-wrap break-words m-0 leading-5">{renderedText}</pre>
        )}
      </div>
    </div>
  );
}
