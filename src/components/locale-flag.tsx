"use client";

import { useId } from "react";
import type { Locale } from "@/lib/i18n/types";

interface LocaleFlagProps {
  locale: Locale;
  className?: string;
}

export function LocaleFlag({
  locale,
  className = "h-5 w-5",
}: LocaleFlagProps) {
  const uid = useId();
  const outerClipId = `${uid}-outer`;
  const globeClipId = `${uid}-globe`;

  return (
    <span
      data-flag={locale}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/10 dark:ring-white/15 ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full"
      >
        <defs>
          <clipPath id={outerClipId}>
            <circle cx="12" cy="12" r="12" />
          </clipPath>
          {locale === "pt-BR" && (
            <clipPath id={globeClipId}>
              <circle cx="12" cy="12" r="4.6" />
            </clipPath>
          )}
        </defs>

        <g clipPath={`url(#${outerClipId})`}>
          {locale === "pt-BR" && (
            <>
              <rect width="24" height="24" fill="#009C3B" />
              <polygon points="12,3.2 21.6,12 12,20.8 2.4,12" fill="#FFDF00" />
              <circle cx="12" cy="12" r="4.6" fill="#002776" />
              <path
                d="M7.1 11.2 Q12 9.6 16.9 12.9"
                stroke="#FFFFFF"
                strokeWidth="1.25"
                fill="none"
                clipPath={`url(#${globeClipId})`}
              />
            </>
          )}

          {locale === "en" && (
            <>
              <rect width="24" height="24" fill="#FFFFFF" />
              <rect y="0" width="24" height="1.85" fill="#B22234" />
              <rect y="3.69" width="24" height="1.85" fill="#B22234" />
              <rect y="7.38" width="24" height="1.85" fill="#B22234" />
              <rect y="11.08" width="24" height="1.85" fill="#B22234" />
              <rect y="14.77" width="24" height="1.85" fill="#B22234" />
              <rect y="18.46" width="24" height="1.85" fill="#B22234" />
              <rect y="22.15" width="24" height="1.85" fill="#B22234" />
              <rect width="12.5" height="12.92" fill="#3C3B6E" />
              {/* Simplified star grid inside canton */}
              <circle cx="4.8" cy="4.3" r="0.65" fill="#FFFFFF" />
              <circle cx="7.6" cy="4.3" r="0.65" fill="#FFFFFF" />
              <circle cx="10.4" cy="4.3" r="0.65" fill="#FFFFFF" />
              <circle cx="3.4" cy="6.6" r="0.65" fill="#FFFFFF" />
              <circle cx="6.2" cy="6.6" r="0.65" fill="#FFFFFF" />
              <circle cx="9.0" cy="6.6" r="0.65" fill="#FFFFFF" />
              <circle cx="4.8" cy="8.9" r="0.65" fill="#FFFFFF" />
              <circle cx="7.6" cy="8.9" r="0.65" fill="#FFFFFF" />
              <circle cx="10.4" cy="8.9" r="0.65" fill="#FFFFFF" />
              <circle cx="3.4" cy="11.2" r="0.65" fill="#FFFFFF" />
              <circle cx="6.2" cy="11.2" r="0.65" fill="#FFFFFF" />
              <circle cx="9.0" cy="11.2" r="0.65" fill="#FFFFFF" />
            </>
          )}

          {locale === "es" && (
            <>
              <rect width="24" height="24" fill="#AA151B" />
              <rect y="6" width="24" height="12" fill="#F1BF00" />
              {/* Simplified Spanish coat of arms */}
              <g transform="translate(5.8, 8.6)">
                <rect x="0.2" y="1.4" width="0.7" height="4.4" rx="0.2" fill="#B8860B" />
                <rect x="4.5" y="1.4" width="0.7" height="4.4" rx="0.2" fill="#B8860B" />
                <path
                  d="M1.4 1.6 H4.0 V4.2 C4.0 5.1 3.4 5.7 2.7 5.9 C2.0 5.7 1.4 5.1 1.4 4.2 Z"
                  fill="#AA151B"
                />
                <rect x="2.7" y="1.6" width="1.3" height="2.0" fill="#D4A017" />
                <path d="M1.5 1.1 H3.9 L3.5 0.3 H1.9 Z" fill="#AA151B" />
                <circle cx="2.7" cy="3.6" r="0.55" fill="#0039A6" />
              </g>
            </>
          )}
        </g>
      </svg>
    </span>
  );
}
