"use client";

import { useEffect, useRef, useState } from "react";

/**
 * ورودی صوتی — فقط صدا را به متن تبدیل می‌کند و در همان لحظه به کاربر
 * برمی‌گرداند تا خودش ببیند و در کادر بنویسد/اصلاح کند. هیچ ثبت خودکاری
 * انجام نمی‌شود؛ دقیقاً مثل جایگزین کیبورد، نه یک تصمیم‌گیرنده.
 */
export function useVoiceInput(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSupported(!!SpeechRecognition);
    if (!SpeechRecognition) return;
    const rec = new SpeechRecognition();
    rec.lang = "fa-IR";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const text = e.results?.[0]?.[0]?.transcript ?? "";
      if (text) onResult(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function start() {
    if (!recRef.current || listening) return;
    try {
      recRef.current.start();
      setListening(true);
    } catch {
      /* در حال حاضر در حال گوش دادن است یا خطای مرورگر */
    }
  }

  function stop() {
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
    setListening(false);
  }

  return { listening, supported, start, stop };
}
