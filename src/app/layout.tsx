import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Poker-Kasse',
  description: 'Pokerabende dokumentieren: Buy-ins, Stacks, Kasse und Schulden.',
  applicationName: 'Poker-Kasse',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  // iOS has no manifest support worth the name: „Zum Home-Bildschirm“ only
  // starts without the Safari chrome when these three tags are present
  // (WP9, step 1). Next renders them from `appleWebApp`.
  appleWebApp: {
    capable: true,
    title: 'Poker-Kasse',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets the page paint into the notch area; the tab bar and the sheets pay it
  // back with `env(safe-area-inset-*)` (WP9, step 5).
  viewportFit: 'cover',
  // The colour of the browser/status bar follows the scheme, so the seam above
  // the sticky header disappears in both themes.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
