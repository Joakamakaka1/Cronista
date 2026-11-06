// First: it reads the sign-in error from the URL before the Supabase client looks at it.
import './session/sign-in-error.ts';
import './styles.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { listenForUncaughtErrors } from './errors/report-client-errors.ts';
import { RootErrorBoundary } from './errors/root-error-boundary.tsx';
import { AppShell } from './screens/app-shell.tsx';
import { ArchivePage } from './screens/chapter/archive-page.tsx';
import { ChapterPage } from './screens/chapter/chapter-page.tsx';
import { PlayersPage } from './screens/players/players-page.tsx';
import { SignInPage } from './screens/sign-in-page.tsx';
import { TodayPage } from './screens/today/today-page.tsx';
import { SessionProvider } from './session/session.tsx';

listenForUncaughtErrors();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 2 } },
});

const router = createBrowserRouter([
  { path: '/entrar', element: <SignInPage /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <TodayPage /> },
      { path: 'capitulos', element: <ArchivePage /> },
      { path: 'capitulos/:day', element: <ChapterPage /> },
      { path: 'personajes', element: <PlayersPage /> },
      { path: '*', element: <TodayPage /> },
    ],
  },
]);

const root = document.querySelector('#root');
if (root === null) throw new Error('index.html has no #root.');

createRoot(root).render(
  <StrictMode>
    <RootErrorBoundary>
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <RouterProvider router={router} />
          </SessionProvider>
        </QueryClientProvider>
      </MotionConfig>
    </RootErrorBoundary>
  </StrictMode>,
);
