import {
  formatXLM,
  formatDate,
  formatDeadline,
  formatMoney,
  formatPrice,
  formatUSDEquivalent,
  getMonthlyEstimate,
  timeAgo,
} from "../utils/format";
import i18next from "../lib/i18n";
import { format as dateFnsFormat } from "date-fns";

jest.mock("../lib/i18n", () => ({
  language: "en-US",
}));

describe("utils/format", () => {
  const mockDate = new Date("2026-08-26T12:00:00Z");

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(mockDate);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    // Reset to english
    (i18next as any).language = "en-US";
  });

  describe("en-US locale", () => {
    beforeEach(() => {
      (i18next as any).language = "en-US";
    });

    it("formats XLM with commas and default 4 decimal precision", () => {
      expect(formatXLM(1234.56789)).toBe("1,234.5679 XLM");
      expect(formatXLM("1000")).toBe("1,000 XLM");
    });

    it("formats money with en-US conventions", () => {
      expect(formatMoney(12345.6)).toBe("12,345.6 XLM");
    });

    it("formats dates according to en-US PP format", () => {
      const dateString = "2026-08-26T12:00:00Z";
      expect(formatDate(dateString)).toMatch(/Aug 26, 2026/); // Might be Aug 26, 2026
    });

    it("formats price and USD equivalent", () => {
      const result = formatPrice(1000.5, 0.1, "XLM");
      expect(result.display).toBe("1,000.5 XLM");
      expect(result.usdEquiv).toBe("$100.05");
    });

    it("timeAgo respects frozen clock", () => {
      const pastDate = new Date(mockDate.getTime() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
      expect(timeAgo(pastDate)).toMatch(/about 2 hours ago/);
    });
  });

  describe("es-ES locale", () => {
    beforeEach(() => {
      (i18next as any).language = "es-ES";
    });

    it("formats XLM with Spanish conventions (dot/comma)", () => {
      // In Spanish, thousands separator is usually . or space, and decimal is ,
      const result = formatXLM(1234.56789);
      // It should replace the dot with comma for decimals, e.g., 1.234,5679 or 1234,5679
      expect(result).toMatch(/1(\.| )234,5679 XLM/);
    });

    it("formats money with Spanish conventions", () => {
      expect(formatMoney(12345.6)).toMatch(/12(\.| )345,6 XLM/);
    });

    it("formats dates according to es-ES PP format", () => {
      const dateString = "2026-08-26T12:00:00Z";
      // Should contain "26" and "ago"
      expect(formatDate(dateString)).toMatch(/26 (de )?ago(sto)?( de)? 2026/i);
    });

    it("formats price and USD equivalent in Spanish locale", () => {
      const result = formatPrice(1000.5, 0.1, "XLM");
      // USD format in Spanish can be "100,05 US$" or "$100,05"
      expect(result.display).toMatch(/1(\.| )000,5 XLM/);
      expect(result.usdEquiv).toMatch(/100,05/);
    });

    it("timeAgo is in Spanish", () => {
      const pastDate = new Date(mockDate.getTime() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
      expect(timeAgo(pastDate)).toMatch(/alrededor de 2 horas/i); // "hace alrededor de 2 horas"
    });
  });

  describe("fr-FR locale", () => {
    beforeEach(() => {
      (i18next as any).language = "fr-FR";
    });

    it("formats dates and numbers in French", () => {
      expect(formatXLM(1234.5)).toMatch(/1(\s|\u202F)234,5 XLM/);
      expect(formatDate("2026-08-26T12:00:00Z")).toMatch(/26 ao(u|û)t 2026/i);
    });
  });
});
