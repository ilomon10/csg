import type {Metadata, Viewport} from 'next';
import type {ReactNode} from 'react';
import {Provider} from '@/components/provider';
import {geist, geistMono, silkscreen} from '@/lib/fonts';
import {SITE_DESCRIPTION} from '@/lib/seo';
import {siteConfig} from '@/lib/site-config';
import './global.css';

export const metadata: Metadata = {
  metadataBase: new URL(`${siteConfig.siteUrl}${siteConfig.basePath}/`),
  title: {
    default: 'Character Sprite Generator',
    template: '%s | Character Sprite Generator',
  },
  description: SITE_DESCRIPTION,
  icons: {icon: `${siteConfig.basePath}/favicon.png`},
};

export const viewport: Viewport = {
  themeColor: [
    {media: '(prefers-color-scheme: light)', color: '#f3f4f6'},
    {media: '(prefers-color-scheme: dark)', color: '#101114'},
  ],
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${silkscreen.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col antialiased">
        <a
          href="#main-content"
          className="sr-only z-50 bg-fd-primary px-4 py-2 text-fd-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
