// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { Dashboard } from './pages/Dashboard';
import { Servers } from './pages/Servers';
import { ServerDetail } from './pages/ServerDetail';
import { Chat } from './pages/Chat';
import { Login } from './pages/Login';
import { Tasks } from './pages/Tasks';
import { Operations } from './pages/Operations';
import { Settings } from './pages/Settings';
import { Search } from './pages/Search';
import { Alerts } from './pages/Alerts';
import { AuditLog } from './pages/AuditLog';
import { Webhooks } from './pages/Webhooks';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<MainLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="servers" element={<Servers />} />
        <Route path="servers/:id" element={<ServerDetail />} />
        <Route path="chat" element={<Chat />} />
        <Route path="chat/:serverId" element={<Chat />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="operations" element={<Operations />} />
        <Route path="search" element={<Search />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="audit-log" element={<AuditLog />} />
        <Route path="webhooks" element={<Webhooks />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
