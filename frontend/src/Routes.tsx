import { Outlet, Route, Routes as ReactRoutes } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import DocumentsPage from './pages/DocumentsPage';
import DocumentPage from './pages/DocumentPage';
import ProgressPage from './pages/ProgressPage';
import ActivityPage from './pages/ActivityPage';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AdminPage from './pages/AdminPage';
import AdminImportPage from './pages/AdminImportPage';
import AdminImportResultsPage from './pages/AdminImportResultsPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminLogsPage from './pages/AdminLogsPage';
import ReaderPage from './pages/ReaderPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AdminRoute } from './auth/AdminRoute';

export function Routes() {
  return (
    <ReactRoutes>
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="documents/:id" element={<DocumentPage />} />
        <Route path="progress" element={<ProgressPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<AdminRoute><Outlet /></AdminRoute>}>
          <Route index element={<AdminPage />} />
          <Route path="import" element={<AdminImportPage />} />
          <Route path="import-results" element={<AdminImportResultsPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="logs" element={<AdminLogsPage />} />
        </Route>
      </Route>
      <Route
        path="/reader/:id"
        element={
          <ProtectedRoute>
            <ReaderPage />
          </ProtectedRoute>
        }
      />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
    </ReactRoutes>
  );
}
