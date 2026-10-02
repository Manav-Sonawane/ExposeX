import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import { PageLoader } from './components/ui';
import AuthPage from './pages/AuthPage';
import Dashboard from './pages/Dashboard';

const Inventory = lazy(() => import('./pages/Inventory'));
const AccountDetail = lazy(() => import('./pages/AccountDetail'));
const GraphPage = lazy(() => import('./pages/GraphPage'));
const Fixes = lazy(() => import('./pages/Fixes'));
const Alerts = lazy(() => import('./pages/Alerts'));
const SettingsPage = lazy(() => import('./pages/Settings'));

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user)
    return (
      <Routes>
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="*" element={<AuthPage mode="login" />} />
      </Routes>
    );
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="accounts/:id" element={<AccountDetail />} />
          <Route path="graph" element={<GraphPage />} />
          <Route path="fixes" element={<Fixes />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
