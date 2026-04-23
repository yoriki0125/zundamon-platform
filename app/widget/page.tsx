'use client';

import { Suspense } from 'react';
import ZundamonWidget from '@/components/widget/ZundamonWidget';

export default function WidgetPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">ウィジェットを読み込み中…</div>}>
      <ZundamonWidget />
    </Suspense>
  );
}
