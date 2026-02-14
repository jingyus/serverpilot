// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supportedLanguages, setStoredLanguage } from "@/i18n";

const LANGUAGE_ORDER: string[] = supportedLanguages.map((l) => l.code);

const LANGUAGE_LABEL: Record<string, string> = {
  en: "English",
  zh: "中文",
};

export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language;

  const handleToggle = () => {
    const currentIndex = LANGUAGE_ORDER.indexOf(currentLang);
    const nextIndex = (currentIndex + 1) % LANGUAGE_ORDER.length;
    const nextLang = LANGUAGE_ORDER[nextIndex] as "en" | "zh";

    i18n.changeLanguage(nextLang);
    setStoredLanguage(nextLang);
  };

  return (
    <button
      type="button"
      aria-label={t("language.toggle")}
      title={LANGUAGE_LABEL[currentLang] || currentLang}
      onClick={handleToggle}
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      data-testid="language-toggle"
    >
      <Globe className="h-5 w-5" />
    </button>
  );
}
