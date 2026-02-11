// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from './App';
import { useAuthStore } from '@/stores/auth';

function renderApp(initialRoute = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: '1', email: 'test@example.com', name: 'Test' },
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
  });

  it('renders dashboard page at /dashboard', () => {
    renderApp('/dashboard');
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });

  it('renders servers page at /servers', () => {
    renderApp('/servers');
    expect(screen.getByRole('heading', { level: 1, name: 'Servers' })).toBeInTheDocument();
  });

  it('renders login page at /login', () => {
    renderApp('/login');
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('renders chat page at /chat', () => {
    renderApp('/chat');
    expect(screen.getByRole('heading', { level: 1, name: 'AI Chat' })).toBeInTheDocument();
  });

  it('renders search page at /search', () => {
    renderApp('/search');
    expect(screen.getByRole('heading', { level: 1, name: 'Knowledge Base' })).toBeInTheDocument();
  });

  it('redirects / to /dashboard', () => {
    renderApp('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });

  it('redirects to /login when not authenticated', () => {
    useAuthStore.setState({ user: null, isAuthenticated: false });
    renderApp('/dashboard');
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });
});
