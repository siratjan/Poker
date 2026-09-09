'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { buildShareText, type ShareTextInput } from '@/lib/settlement/shareText';

/**
 * „Abrechnung kopieren“ (docs/ARBEITSPAKETE.md WP6, step 5): puts the plain
 * text of `buildShareText()` on the clipboard, ready to paste into WhatsApp.
 *
 * Three ways out, because `navigator.clipboard` is unavailable in exactly the
 * situation this button is for — a phone on a page that is not served over
 * HTTPS, or a browser that refuses the permission:
 *
 * 1. `navigator.clipboard.writeText`.
 * 2. A hidden textarea plus `document.execCommand('copy')` (deprecated, still
 *    the reliable fallback on older mobile browsers).
 * 3. The text is shown in a textarea, selected, with the hint to copy by hand.
 */
export function CopySettlementButton(props: ShareTextInput) {
  const { showSuccess, showError } = useToast();
  const [manualText, setManualText] = useState<string | null>(null);

  function copy() {
    const text = buildShareText(props);

    void writeToClipboard(text).then((copied) => {
      if (copied) {
        setManualText(null);
        showSuccess('Abrechnung kopiert.');
        return;
      }
      // Nothing worked: show the text so it can be selected by hand.
      setManualText(text);
      showError('Kopieren hat nicht geklappt. Der Text steht jetzt zum Markieren da.');
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" size="lg" onClick={copy}>
        Abrechnung kopieren
      </Button>
      {manualText === null ? null : (
        <textarea
          readOnly
          rows={10}
          value={manualText}
          aria-label="Abrechnung zum Kopieren"
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded-xl border border-black/15 bg-transparent p-3 font-mono text-xs dark:border-white/20"
        />
      )}
    </div>
  );
}

/** `true` when the text reached the clipboard by either route. */
async function writeToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // permission denied or insecure context — fall through
    }
  }
  return copyViaTextarea(text);
}

/** Fallback for browsers without the async clipboard API. */
function copyViaTextarea(text: string): boolean {
  if (typeof document === 'undefined') return false;

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  // Off-screen but focusable; `display: none` would not be selectable.
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);

  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}
