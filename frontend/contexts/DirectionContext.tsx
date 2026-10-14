import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import i18next from "@/lib/i18n";

const RTL_LOCALES = ["ar", "he", "fa", "ur"];

export type Direction = "ltr" | "rtl";

interface DirectionValue {
  direction: Direction;
  isRtl: boolean;
}

const DirectionContext = createContext<DirectionValue>({ direction: "ltr", isRtl: false });

function getDirection(lang: string): Direction {
  const base = (lang || "").split("-")[0];
  return RTL_LOCALES.includes(base) ? "rtl" : "ltr";
}

export function DirectionProvider({ children }: { children: ReactNode }) {
  const [direction, setDirection] = useState<Direction>(() => getDirection(i18next.language));

  useEffect(() => {
    const onLangChange = (lng: string) => {
      const dir = getDirection(lng);
      setDirection(dir);
      document.documentElement.dir = dir;
      document.documentElement.lang = lng;
    };

    onLangChange(i18next.language);
    i18next.on("languageChanged", onLangChange);
    return () => {
      i18next.off("languageChanged", onLangChange);
    };
  }, []);

  return (
    <DirectionContext.Provider value={{ direction, isRtl: direction === "rtl" }}>
      {children}
    </DirectionContext.Provider>
  );
}

export function useDirection(): DirectionValue {
  return useContext(DirectionContext);
}
