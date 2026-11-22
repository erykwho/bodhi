"use client";

import { useEffect } from "react";
import { getMessages, resolveLocale } from "@/lib/i18n/locale";
import { LOCALE_STORAGE_KEY } from "@/lib/i18n/types";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

function readStoredLocaleSafe() {
  try {
    if (typeof window === "undefined") return resolveLocale(null);
    return resolveLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return resolveLocale(null);
  }
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("[bodhi] Unhandled global error:", error);
  }, [error]);

  const locale = readStoredLocaleSafe();
  const m = getMessages(locale);

  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          backgroundColor: "#f7f4ee",
          color: "#222623",
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "380px",
            borderRadius: "24px",
            backgroundColor: "#fcfaf6",
            border: "1px solid rgba(0, 0, 0, 0.08)",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
            {m.errorBoundary.title}
          </h1>
          <p
            style={{
              marginTop: "8px",
              marginBottom: "20px",
              fontSize: "14px",
              lineHeight: 1.5,
              color: "#5f6660",
            }}
          >
            {m.errorBoundary.body}
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px",
            }}
          >
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: "44px",
                borderRadius: "14px",
                border: "1px solid rgba(0, 0, 0, 0.1)",
                backgroundColor: "#f7f4ee",
                color: "#222623",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {m.errorBoundary.reloadApp}
            </button>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                height: "44px",
                borderRadius: "14px",
                border: "none",
                backgroundColor: "#5b7c65",
                color: "#fcfaf6",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {m.errorBoundary.tryAgain}
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
