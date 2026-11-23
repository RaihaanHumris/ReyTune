import React from 'react';
import { CheckCircle2, Download, Share, Smartphone, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface PWAInstallModalProps {
  isOpen: boolean;
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  onClose: () => void;
  onNativeInstall: () => Promise<boolean>;
}

export const PWAInstallModal: React.FC<PWAInstallModalProps> = ({
  isOpen,
  isInstallable,
  isInstalled,
  isIOS,
  onClose,
  onNativeInstall,
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Install ReyTune PWA"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-md p-0 sm:p-4"
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-md rounded-t-3xl sm:rounded-3xl dynamic-glass-elevated p-6 space-y-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <img
                  src="/pwa-192x192.png"
                  alt="ReyTune app icon"
                  className="w-12 h-12 rounded-2xl border border-white/15 shadow-md"
                />
                <div>
                  <h2 className="text-lg font-bold text-[#F8FAFC]">Install ReyTune</h2>
                  <p className="text-xs text-[#94A3B8]">
                    Progressive Web App · Offline Ready
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close install dialog"
                className="flex items-center justify-center min-h-[44px] min-w-[44px] -mr-2 -mt-2 rounded-full text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/[0.08]"
              >
                <X size={20} />
              </button>
            </div>

            {isInstalled ? (
              <div className="rounded-2xl bg-[#10B981]/10 border border-[#10B981]/30 p-4 flex items-center gap-3">
                <CheckCircle2 size={20} className="text-[#10B981] shrink-0" />
                <p className="text-sm text-[#F8FAFC]">
                  ReyTune is already installed in standalone mode on this device.
                </p>
              </div>
            ) : isInstallable ? (
              <div className="space-y-4">
                <p className="text-sm text-[#94A3B8] leading-relaxed">
                  Install ReyTune on your home screen for instant launch, full-screen playback, and offline access to downloaded music.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    const accepted = await onNativeInstall();
                    if (accepted) onClose();
                  }}
                  className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-[#10B981] hover:bg-[#059669] text-[#0B0F17] text-sm font-semibold transition-colors"
                >
                  <Download size={18} />
                  <span>Install ReyTune Now</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-[#94A3B8] leading-relaxed">
                  Follow your browser&apos;s quick step below to install ReyTune directly to your home screen or desktop apps:
                </p>

                {isIOS ? (
                  <div className="rounded-2xl bg-[#0B0F17] border border-[#1E293B] p-4 space-y-2.5 text-xs text-[#F8FAFC]">
                    <div className="flex items-center gap-2 text-[#10B981] font-semibold">
                      <Share size={15} />
                      <span>iPhone / iPad (Safari)</span>
                    </div>
                    <p className="text-[#94A3B8]">1. Tap the Share icon in the Safari toolbar.</p>
                    <p className="text-[#94A3B8]">2. Scroll down and select <strong className="text-[#F8FAFC]">Add to Home Screen</strong>.</p>
                    <p className="text-[#94A3B8]">3. Tap <strong className="text-[#F8FAFC]">Add</strong> to install ReyTune.</p>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-[#0B0F17] border border-[#1E293B] p-4 space-y-2.5 text-xs text-[#F8FAFC]">
                    <div className="flex items-center gap-2 text-[#10B981] font-semibold">
                      <Smartphone size={15} />
                      <span>Android / Chrome / Edge</span>
                    </div>
                    <p className="text-[#94A3B8]">
                      1. Open your browser menu (<strong className="text-[#F8FAFC]">⋮</strong>) or click the Install icon in the address bar.
                    </p>
                    <p className="text-[#94A3B8]">
                      2. Choose <strong className="text-[#F8FAFC]">Install App</strong> or <strong className="text-[#F8FAFC]">Add to Home screen</strong>.
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="w-full h-11 rounded-xl bg-[#1E293B] hover:bg-[#334155] text-sm font-medium text-[#F8FAFC] transition-colors"
                >
                  Got it
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
