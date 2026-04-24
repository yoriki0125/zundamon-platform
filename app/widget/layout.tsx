/**
 * ウィジェットページ専用レイアウト。
 * ルートレイアウト (app/layout.tsx) が html/body に h-full overflow-hidden を
 * 付与しているため、iframe 内での postResize 高さ計測が狂わないよう上書きする。
 */
export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: `
        html, body {
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
          background: transparent !important;
        }
      `}} />
      {children}
    </>
  );
}
