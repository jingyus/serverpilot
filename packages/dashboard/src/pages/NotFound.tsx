// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home } from 'lucide-react';

export function NotFound() {
  const { t } = useTranslation();

  return (
    <div
      data-testid="not-found-page"
      className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4"
    >
      <h1 className="text-6xl font-bold text-gray-300 dark:text-gray-600 mb-4">
        404
      </h1>
      <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
        {t('notFound.title')}
      </h2>
      <p className="text-gray-500 dark:text-gray-400 mb-8 max-w-md">
        {t('notFound.description')}
      </p>
      <Link
        to="/dashboard"
        data-testid="back-home-link"
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        <Home className="h-4 w-4" />
        {t('notFound.backHome')}
      </Link>
    </div>
  );
}
