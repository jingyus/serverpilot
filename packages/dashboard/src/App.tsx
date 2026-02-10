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
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
