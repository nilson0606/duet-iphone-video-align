import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '合拍 DUET｜雙影片融合',
  icons: { icon: '/favicon.svg' },
  description:
    '用聲音同步兩個視角，在 iPhone 自由構圖、融合與儲存。影片只在你的裝置處理。',
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#101313',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
