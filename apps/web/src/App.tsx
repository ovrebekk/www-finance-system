import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Route, Routes } from 'react-router';
import { RequestError, setUnauthorizedHandler } from './lib/api';
import { keys, useMe } from './lib/queries';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { AccountsPage } from './pages/AccountsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RecipientsPage } from './pages/RecipientsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TagsPage } from './pages/TagsPage';
import { TransactionsPage } from './pages/TransactionsPage';

export function App() {
  const qc = useQueryClient();
  const me = useMe();

  useEffect(() => {
    setUnauthorizedHandler(() => qc.setQueryData(keys.me, null));
  }, [qc]);

  if (me.isPending) return <Loading />;
  if (!me.data && me.error instanceof RequestError && me.error.status === 0) {
    return (
      <div className="login">
        <div className="login-card">
          <p>You are offline, and this device has no saved copy of the app's data yet. Connect once and sign in to use it offline.</p>
          <button type="button" className="button button-primary" onClick={() => void me.refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!me.data) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="recipients" element={<RecipientsPage />} />
        <Route path="tags" element={<TagsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
