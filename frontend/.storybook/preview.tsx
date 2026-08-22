import React, { useEffect } from "react";
import type { Preview, Decorator } from "@storybook/react";
import "../styles/globals.css";
import { ThemeProvider, useTheme } from "../contexts/ThemeContext";
import { PriceProvider } from "../contexts/PriceContext";
import { StellarAccountProvider } from "../contexts/StellarAccountContext";
import { ToastProvider } from "../components/Toast";
import i18next from "../lib/i18n";
import { I18nextProvider } from "react-i18next";

const withAppProviders: Decorator = (Story, context) => {
  const theme = context.globals.theme || "dark";
  const locale = context.globals.locale || "en";

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  useEffect(() => {
    if (i18next.language !== locale) {
      i18next.changeLanguage(locale);
    }
  }, [locale]);

  return (
    <I18nextProvider i18n={i18next}>
      <ThemeProvider>
        <PriceProvider>
          <StellarAccountProvider>
            <ToastProvider>
              <div
                className={`min-h-screen p-6 ${
                  theme === "dark"
                    ? "dark bg-[#0c0a06] text-[#fef3c7]"
                    : "bg-[#fafaf8] text-[#1c1917]"
                }`}
              >
                <Story />
              </div>
            </ToastProvider>
          </StellarAccountProvider>
        </PriceProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
};

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "dark",
      values: [
        { name: "dark", value: "#0c0a06" },
        { name: "light", value: "#fafaf8" },
      ],
    },
    a11y: {
      config: {
        rules: [
          { id: "color-contrast", enabled: true },
          { id: "button-name", enabled: true },
          { id: "image-alt", enabled: true },
        ],
      },
    },
  },
  globalTypes: {
    theme: {
      name: "Theme",
      description: "Global theme for components",
      defaultValue: "dark",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "dark", icon: "moon", title: "Dark Mode" },
          { value: "light", icon: "sun", title: "Light Mode" },
        ],
        showName: true,
      },
    },
    locale: {
      name: "Locale",
      description: "Internationalization locale",
      defaultValue: "en",
      toolbar: {
        icon: "globe",
        items: [
          { value: "en", title: "English" },
          { value: "es", title: "Español" },
          { value: "fr", title: "Français" },
          { value: "pt", title: "Português" },
        ],
        showName: true,
      },
    },
  },
  decorators: [withAppProviders],
};

export default preview;
