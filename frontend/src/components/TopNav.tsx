import { BarChart3, LayoutDashboard, Terminal, User, Settings, SlidersHorizontal } from 'lucide-react';

interface TopNavProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
  deviceType: 'gs' | 'fc';
}

export default function TopNav({ activeTab, onTabChange, deviceType }: TopNavProps) {
  const tabs = [
    { id: 'dashboard', label: 'DASHBOARD', icon: LayoutDashboard },
    { id: 'data', label: 'DATA', icon: BarChart3 },
    ...(deviceType === 'fc' ? [{ id: 'parameters', label: 'PARAMETERS', icon: SlidersHorizontal }] : []),
    { id: 'terminal', label: 'TERMINAL', icon: Terminal },
    { id: 'command', label: 'COMMAND', icon: User },
    { id: 'settings', label: 'SETTINGS', icon: Settings },
  ];

  return (
    <div className="absolute top-0 left-0 right-0 z-50">
      <div className="text-center py-2 text-gray-400 text-sm tracking-widest border-b border-gray-700/50">
        CERBERUS MISSION DASHBOARD V2
      </div>
      <div className="flex justify-center items-center gap-8 py-4 bg-gradient-to-b from-gray-900/80 to-transparent">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`flex flex-col items-center gap-1 px-6 py-2 transition-colors ${
              tab.id === activeTab
                ? 'text-orange-500 border-b-2 border-orange-500'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <tab.icon size={24} />
            <span className="text-xs font-semibold tracking-wider">{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
