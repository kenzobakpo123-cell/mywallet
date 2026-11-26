"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/icons";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_KEY = "finwise-install-dismissed-v1";

function alreadyInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || iosStandalone;
}

export default function PwaRegister() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // PWA tetap bisa dipasang walau service worker gagal didaftarkan.
      });
    }

    if (alreadyInstalled()) return;
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
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Abaikan penyimpanan yang diblokir.
    }
  }, []);

  const install = useCallback(async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
    setVisible(false);
  }, [installEvent]);

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
