import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/design/tokens.css';
import '@/design/styles-gallery.css';
import '@/design/base.css';
import '@/design/components.css';
import '@/design/pages.css';
import '@/design/collections.css';
import '@/design/media.css';
import '@/design/export.css';

import { App } from '@/App';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('找不到 #root 挂载点');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
