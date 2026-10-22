import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import { RequestError } from './lib/api';
import { ToastProvider } from './components/Toast';
import { App } from './App';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Always try the request: the service worker answers from its cache when offline.
      networkMode: 'offlineFirst',
      retry: (count, err) => !(err instanceof RequestError && err.status >= 400 && err.status < 500) && count < 2,
    },
    // Fail fast instead of pausing, so a new transaction can be queued on the device.
    mutations: { networkMode: 'always' },
  },
});

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
