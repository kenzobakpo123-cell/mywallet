"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/icons";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_KEY = "finwise-install-dismissed-v1";
const IOS_DISMISS_KEY = "finwise-ios-install-tip-dismissed-v1";

function alreadyInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || iosStandalone;
}

/**
 * Safari iOS tidak memicu `beforeinstallprompt`, jadi tombol "Pasang" otomatis
 * tidak akan pernah muncul di iPhone/iPad. Yang bisa dilakukan adalah
 * mengarahkan pengguna ke menu Bagikan → Tambahkan ke Layar Utama.
 */
function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export default function PwaRegister() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [iosTip, setIosTip] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // PWA tetap bisa dipasang walau service worker gagal didaftarkan.
      });
    }

    if (alreadyInstalled()) return;

    if (isIosSafari()) {
      let dismissed = false;
      try {
        dismissed = localStorage.getItem(IOS_DISMISS_KEY) === "1";
      } catch {
        // localStorage bisa diblokir; abaikan.
      }
      if (!dismissed) {
        const timer = window.setTimeout(() => setIosTip(true), 1200);
        return () => window.clearTimeout(timer);
      }
      return;
    }

    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // localStorage bisa diblokir; abaikan.
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setInstallEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setInstallEvent(null);
    setIosTip(false);
    try {
      localStorage.setItem(iosTip ? IOS_DISMISS_KEY : DISMISS_KEY, "1");
    } catch {
      // Abaikan penyimpanan yang diblokir.
    }
  }, [iosTip]);

  const install = useCallback(async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
    setVisible(false);
  }, [installEvent]);

  if (iosTip) {
    return (
      <div className="install-prompt" role="status" aria-live="polite">
        <div className="install-copy">
          <span className="install-kicker">Finwise di iPhone/iPad</span>
          <strong>Tambahkan ke Layar Utama</strong>
          <small>Ketuk tombol Bagikan (kotak dengan panah ke atas), lalu pilih “Tambahkan ke Layar Utama”.</small>
        </div>
        <div className="install-actions">
          <button type="button" className="btn btn-quiet btn-small" onClick={dismiss}>
            Mengerti
          </button>
        </div>
      </div>
    );
  }

  if (!visible) return null;

  return (
    <div className="install-prompt" role="status" aria-live="polite">
      <div className="install-copy">
        <span className="install-kicker">Finwise</span>
        <strong>Pasang di perangkat ini</strong>
        <small>Buka seperti aplikasi, tanpa toko aplikasi.</small>
      </div>
      <div className="install-actions">
        <button type="button" className="btn btn-quiet btn-small" onClick={dismiss}>
          Nanti
        </button>
        <button type="button" className="btn btn-primary btn-small" onClick={install}>
          <Icon name="download" size={14} />
          Pasang
        </button>
      </div>
    </div>
  );
}
