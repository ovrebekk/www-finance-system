import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Route, Routes } from 'react-router';
import { setUnauthorizedHandler } from './lib/api';
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
