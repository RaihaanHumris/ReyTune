import React from 'react';
import { Compass, Library, Settings } from 'lucide-react';
import { NavTab } from '../types/music';

interface BottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

const NAV_ITEMS: { id: NavTab; label: string; Icon: React.FC<{ size?: number; strokeWidth?: number }> }[] = [
  { id: 'explore', label: 'Explore', Icon: Compass },
  { id: 'library', label: 'Library', Icon: Library },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onSelectTab }) => {
  return (
    <nav
      aria-label="Primary Navigation"
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-40 bg-[#0B0F17]/95 backdrop-blur-md border-t border-[#1E293B]"
    >
      <div className="grid grid-cols-3 h-16 items-center px-2">
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectTab(id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex flex-col items-center justify-center min-h-[48px] rounded-xl transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[#10B981] whitespace-nowrap shrink-0 ${
                isActive ? 'text-[#10B981]' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              <Icon size={21} strokeWidth={isActive ? 2.25 : 1.75} />
              <span className="text-[11px] font-medium mt-1 tracking-tight">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
