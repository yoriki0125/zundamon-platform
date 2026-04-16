import type { Metadata } from 'next';
import { Noto_Sans_JP, Geist_Mono } from 'next/font/google';
import './globals.css';

const notoSansJP = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  variable: '--font-sans',
});
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'ずんだもん Studio',
  description: 'ずんだもんと話そう — Zundamon VRM 3D Character App',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${notoSansJP.variable} ${geistMono.variable} h-full bg-background`}>
      <body className="h-full overflow-hidden font-sans antialiased">{children}</body>
    </html>
  );
}
