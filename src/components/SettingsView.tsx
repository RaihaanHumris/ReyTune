import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Download,
  HardDrive,
  Lock,
  SlidersHorizontal,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { AudioQuality, StorageStats } from '../types/music';

interface SettingsViewProps {
  audioQuality: AudioQuality;
  onChangeQuality: (quality: AudioQuality) => void;
  storageStats: StorageStats;
  onClearAllDownloads: () => void;
  isInstallable: boolean;
  isInstalled: boolean;
  onOpenInstallModal: () => void;
  keepScreenAwake?: boolean;
  onToggleKeepScreenAwake?: () => void;
}

const QUALITY_OPTIONS: {
  id: AudioQuality;
  label: string;
  detail: string;
}[] = [
  { id: '320', label: 'High Fidelity', detail: '320 kbps · Best clarity' },
  { id: '192', label: 'Balanced', detail: '192 kbps · Recommended' },
  { id: '96', label: 'Data Saver', detail: '96 kbps · Compact files' },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  audioQuality,
  onChangeQuality,
  storageStats,
  onClearAllDownloads,
  isInstallable,
  isInstalled,
  onOpenInstallModal,
  keepScreenAwake = false,
  onToggleKeepScreenAwake,
}) => {
  const [confirmClear, setConfirmClear] = useState(false);
  const [swReady, setSwReady] = useState(false);
  const hasMediaSession =
    typeof navigator !== 'undefined' && 'mediaSession' in navigator;

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => {
          setSwReady(regs.length > 0);
        })
        .catch(() => {});
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* Lock Screen & Background Playback Card */}
      <section className="rounded-2xl bg-[#131A26] border border-[#1E293B] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Lock size={18} className="text-[#10B981]" />
            <h2 className="text-base font-semibold text-[#F8FAFC]">
              Layar Kunci &amp; Layar Mati
            </h2>
          </div>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-[#10B981]/15 text-[#10B981]">
            {hasMediaSession ? 'MediaSession Aktif' : 'Background Audio'}
          </span>
        </div>

        <p className="text-xs text-[#94A3B8] leading-relaxed">
          Kontrol musik otomatis tampil di <strong>Layar Kunci (Lock Screen)</strong> dan panel notifikasi HP saat layar mati—lengkap dengan sampul album, tombol Play/Pause, Next/Prev, serta geser durasi lagu.
        </p>

        <div className="rounded-xl bg-[#0B0F17]/70 border border-[#1E293B] p-3 space-y-2 text-xs text-[#94A3B8]">
          <div className="flex items-center gap-2 text-[#F8FAFC] font-medium">
            <CheckCircle2 size={14} className="text-[#10B981] shrink-0" />
            <span>Pemutaran Latar Belakang &amp; Auto-Next Lagu Aktif</span>
          </div>
          <div className="flex items-center gap-2 text-[#F8FAFC] font-medium">
            <CheckCircle2 size={14} className="text-[#10B981] shrink-0" />
            <span>Widget Kontrol Musik di Layar Kunci Android &amp; iOS</span>
          </div>
        </div>

        {onToggleKeepScreenAwake && (
          <button
            type="button"
            role="switch"
            aria-checked={keepScreenAwake}
            onClick={onToggleKeepScreenAwake}
            className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-[#0B0F17]/60 border border-[#1E293B] hover:border-[#10B981]/50 transition-colors text-left"
          >
            <div>
              <p className="text-xs font-semibold text-[#F8FAFC]">
                Wake Lock (Cegah Sleep Saat Player Terbuka)
              </p>
              <p className="text-[11px] text-[#94A3B8]">
                Menjaga koneksi pemutar tetap stabil di HP
              </p>
            </div>
            <span
              className={`w-9 h-5 rounded-full p-0.5 transition-colors flex items-center shrink-0 ${
                keepScreenAwake ? 'bg-[#10B981]' : 'bg-[#334155]'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full bg-[#0B0F17] transition-transform ${
                  keepScreenAwake ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </span>
          </button>
        )}
      </section>

      {/* PWA Install & Offline Readiness */}
      <section className="rounded-2xl bg-[#131A26] border border-[#1E293B] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Smartphone size={18} className="text-[#10B981]" />
            <h2 className="text-base font-semibold text-[#F8FAFC]">
              Install ReyTune (PWA)
            </h2>
          </div>
          <span className="text-[11px] font-medium text-[#10B981]">
            {swReady ? 'SW Active' : 'PWA Ready'}
          </span>
        </div>

        {isInstalled ? (
          <div className="flex items-center gap-2 text-xs text-[#10B981] font-medium py-1">
            <CheckCircle2 size={15} />
            <span>
              ReyTune terpasang sebagai aplikasi penuh (mendukung layar mati &amp; offline).
            </span>
          </div>
        ) : (
          <>
            <p className="text-xs text-[#94A3B8] leading-relaxed">
              Pasang ReyTune ke layar utama HP agar pemutaran saat layar terkunci / HP mati berjalan seperti aplikasi musik bawaan.
            </p>
            <button
              type="button"
              onClick={onOpenInstallModal}
              className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-[#10B981] hover:bg-[#059669] active:scale-[0.98] text-[#0B0F17] text-sm font-semibold transition-all"
            >
              <Download size={16} />
              <span>
                {isInstallable ? 'Install ReyTune App' : 'Panduan Install Aplikasi'}
              </span>
            </button>
          </>
        )}
      </section>

      {/* Audio Download Quality */}
      <section className="rounded-2xl bg-[#131A26] border border-[#1E293B] p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal size={18} className="text-[#10B981]" />
          <h2 className="text-base font-semibold text-[#F8FAFC]">
            Download Audio Quality
          </h2>
        </div>
        <p className="text-xs text-[#94A3B8]">
          Higher bitrates increase clarity and local storage usage per saved song.
        </p>

        <div className="space-y-2 pt-1">
          {QUALITY_OPTIONS.map((option) => {
            const isSelected = audioQuality === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onChangeQuality(option.id)}
                aria-pressed={isSelected}
                className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl border text-left transition-colors ${
                  isSelected
                    ? 'bg-[#1E293B] border-[#10B981]/60'
                    : 'bg-[#0B0F17]/50 border-[#1E293B] hover:bg-[#1E293B]/60'
                }`}
              >
                <div>
                  <p className="text-sm font-medium text-[#F8FAFC]">
                    {option.label}
                  </p>
                  <p className="text-xs text-[#94A3B8]">{option.detail}</p>
                </div>
                {isSelected && (
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#10B981]/20 text-[#10B981]">
                    <Check size={14} strokeWidth={2.5} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Cache & Storage Management */}
      <section className="rounded-2xl bg-[#131A26] border border-[#1E293B] p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <HardDrive size={18} className="text-[#10B981]" />
          <h2 className="text-base font-semibold text-[#F8FAFC]">
            Cache &amp; Local Storage
          </h2>
        </div>

        <div className="flex items-center justify-between text-sm py-1 border-b border-[#1E293B]">
          <span className="text-[#94A3B8]">Cached Audio (IndexedDB)</span>
          <span className="font-mono tabular-nums font-medium text-[#F8FAFC]">
            {storageStats.usedMb.toFixed(1)} MB ({storageStats.downloadedCount}{' '}
            tracks)
          </span>
        </div>

        {!confirmClear ? (
          <button
            type="button"
            disabled={storageStats.downloadedCount === 0}
            onClick={() => setConfirmClear(true)}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#EF4444] text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 size={16} />
            <span>Clear Offline Cache</span>
          </button>
        ) : (
          <div className="rounded-xl bg-[#0B0F17] border border-[#EF4444]/40 p-3 space-y-2.5">
            <p className="text-xs text-[#F8FAFC]">
              Remove all {storageStats.downloadedCount} downloaded tracks from
              offline cache?
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onClearAllDownloads();
                  setConfirmClear(false);
                }}
                className="flex-1 h-9 rounded-lg bg-[#EF4444] hover:bg-[#DC2626] text-white text-xs font-semibold"
              >
                Confirm Clear
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="flex-1 h-9 rounded-lg bg-[#1E293B] text-[#F8FAFC] text-xs font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
