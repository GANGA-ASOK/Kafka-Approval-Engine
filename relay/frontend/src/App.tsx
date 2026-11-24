import { Outlet, createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './lib/AuthProvider';
import { AppShell } from './layouts/AppShell';
import { RequireAuth, RequireRole } from './layouts/Guards';
import Login from './pages/Login';
import Register from './pages/Register';
import Overview from './pages/Overview';
import NewRequest from './pages/NewRequest';
import { Inbox, MyRequests } from './pages/RequestLists';
import RequestDetail from './pages/RequestDetail';
import AuditLog from './pages/AuditLog';
import NotFound from './pages/NotFound';

function Root() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/register', element: <Register /> },
      {
        element: (
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <Overview /> },
          { path: 'dashboard', element: <Overview /> },
          { path: 'requests', element: <MyRequests /> },
          { path: 'requests/new', element: <NewRequest /> },
          { path: 'requests/:id', element: <RequestDetail /> },
          {
            path: 'inbox',
            element: (
              <RequireRole roles={['MANAGER', 'FINANCE', 'DIRECTOR', 'ADMIN']}>
                <Inbox />
              </RequireRole>
            ),
          },
          { path: 'audit', element: <AuditLog /> },
          {
            path: 'admin',
            element: (
              <RequireRole roles={['ADMIN']}>
                <Outlet />
              </RequireRole>
            ),
            children: [
              { path: 'workflows', lazy: () => import('./pages/admin/Workflows').then((m) => ({ Component: m.default })) },
              { path: 'workflows/new', lazy: () => import('./pages/admin/WorkflowEditor').then((m) => ({ Component: m.default })) },
              { path: 'workflows/:id/edit', lazy: () => import('./pages/admin/WorkflowEditor').then((m) => ({ Component: m.default })) },
              { path: 'dlq', lazy: () => import('./pages/admin/DeadLetters').then((m) => ({ Component: m.default })) },
              { path: 'users', lazy: () => import('./pages/admin/Users').then((m) => ({ Component: m.default })) },
            ],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
