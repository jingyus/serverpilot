// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from "react-i18next";
import { Globe, Check } from "lucide-react";
import { supportedLanguages, setStoredLanguage } from "@/i18n";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown";
import { useNotificationsStore } from "@/stores/notifications";

export function LanguageSelector() {
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode);
    setStoredLanguage(langCode);
    useNotificationsStore.getState().add({
      type: "success",
      title: t("settings.languageSaved"),
    });
  };

  const trigger = (
    <button
      type="button"
      aria-label={t("header.language")}
      title={t("header.language")}
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      data-testid="language-selector-trigger"
    >
      <Globe className="h-5 w-5" />
    </button>
  );

  return (
    <DropdownMenu trigger={trigger} align="right">
      {supportedLanguages.map((lang) => (
        <DropdownMenuItem
          key={lang.code}
          onClick={() => handleLanguageChange(lang.code)}
          testId={`language-option-${lang.code}`}
        >
          <span className="flex-1">{lang.label}</span>
          {i18n.language === lang.code && <Check className="h-4 w-4" />}
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}
