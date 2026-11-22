import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { statusOf } from './lib/api';
import './index.css';
import App from './App.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      // Don't hammer the API on client errors (401/403/404/422); retry network and 5xx twice.
      retry: (count, err) => {
        const s = statusOf(err);
        if (s && s >= 400 && s < 500) return false;
        return count < 2;
      },
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="bottom-right"
        closeButton
        toastOptions={{
          classNames: {
            toast: '!rounded-[var(--radius-control)] !border-line !bg-surface !text-ink !shadow-[var(--shadow-pop)] !font-sans',
            description: '!text-muted',
          },
        }}
      />
    </QueryClientProvider>
  </StrictMode>,
);
