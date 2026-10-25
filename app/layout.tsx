import type { Metadata, Viewport } from 'next';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/vt323/400.css';
import './globals.css';

export const metadata: Metadata = { title: 'Cubbie Royale', description: 'Your grades power your attacks.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1b2169' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
