// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LanguageToggle } from "./LanguageToggle";
import * as i18nModule from "@/i18n";

vi.mock("@/i18n", () => ({
  supportedLanguages: [
    { code: "en", label: "English" },
    { code: "zh", label: "中文" },
  ],
  setStoredLanguage: vi.fn(),
}));

const mockChangeLanguage = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: "en",
      changeLanguage: mockChangeLanguage,
    },
  }),
}));

describe("LanguageToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Globe icon", () => {
    render(<LanguageToggle />);
    expect(screen.getByTestId("language-toggle")).toBeInTheDocument();
  });

  it("shows current language in title", () => {
    render(<LanguageToggle />);
    const button = screen.getByTestId("language-toggle");
    expect(button).toHaveAttribute("title", "English");
  });

  it("cycles through languages on click", () => {
    render(<LanguageToggle />);
    const button = screen.getByTestId("language-toggle");

    fireEvent.click(button);

    expect(mockChangeLanguage).toHaveBeenCalledWith("zh");
    expect(i18nModule.setStoredLanguage).toHaveBeenCalledWith("zh");
  });

  it("applies correct styles", () => {
    render(<LanguageToggle />);
    const button = screen.getByTestId("language-toggle");

    expect(button).toHaveClass(
      "flex h-8 w-8 items-center justify-center rounded-md",
    );
    expect(button).toHaveClass(
      "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
    );
  });

  it("has proper accessibility attributes", () => {
    render(<LanguageToggle />);
    const button = screen.getByTestId("language-toggle");

    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-label", "language.toggle");
    expect(button).toHaveAttribute("title");
  });
});
