// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';

const LANGUAGE_KEY = 'serverpilot_language';

function getStoredLanguage(): string {
  try {
    return localStorage.getItem(LANGUAGE_KEY) ?? 'en';
  } catch {
    return 'en';
  }
}

export function setStoredLanguage(lng: string): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, lng);
  } catch {
    // localStorage unavailable (e.g. private browsing)
  }
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: getStoredLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export const supportedLanguages = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
] as const;

export default i18n;
