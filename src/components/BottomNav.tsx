import React from 'react';
import { Compass, Library, Settings } from 'lucide-react';
import { motion } from 'motion/react';
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
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-40 pt-1.5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] sm:pb-3 px-3 pointer-events-none"
    >
      <div className="pointer-events-auto relative grid grid-cols-3 gap-1.5 h-15 items-center dynamic-glass-dock rounded-2xl px-2 overflow-hidden">
        {/* Subtle top specular reflection line */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
        />

        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectTab(id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center min-h-[46px] rounded-xl transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[#10B981] whitespace-nowrap shrink-0 ${
                isActive
                  ? 'text-[#10B981]'
                  : 'text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="bottom-nav-glass-pill"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  className="absolute inset-0 rounded-xl bg-white/[0.08] border border-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_4px_14px_rgba(16,185,129,0.14)]"
                />
              )}
              <span className="relative z-10 flex flex-col items-center">
                <Icon size={20} strokeWidth={isActive ? 2.25 : 1.75} />
                <span className="text-[11px] font-medium mt-1 tracking-tight">{label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};


