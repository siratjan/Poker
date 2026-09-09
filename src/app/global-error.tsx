'use client';

import { useEffect } from 'react';

/**
 * Last line of defence (docs/ARBEITSPAKETE.md WP9, step 3).
 *
 * Next renders this instead of the root layout when the root layout itself
 * fails — so `globals.css`, the fonts and every component above may be gone.
 * That is why this file styles itself inline and imports nothing but React:
 * anything else could be exactly what is broken.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          background: '#ffffff',
          color: '#171717',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ maxWidth: '24rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
            Poker-Kasse ist abgestürzt.
          </h1>
          <p style={{ fontSize: '0.875rem', opacity: 0.8, margin: '0 0 1.25rem' }}>
            Das war ein Fehler in der App, nicht in deinen Daten. Alles Gespeicherte ist
            unverändert.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: '52px',
              width: '100%',
              borderRadius: '0.75rem',
              border: 'none',
              background: '#047857',
              color: '#ffffff',
              fontSize: '1rem',
              fontWeight: 500,
            }}
          >
            Erneut versuchen
          </button>
          {error.digest === undefined ? null : (
            <p style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '1rem' }}>
              Fehlerkennung: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
