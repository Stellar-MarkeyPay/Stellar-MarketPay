interface AppFooterProps {
  onOpenShortcuts: () => void;
}

export default function AppFooter({ onOpenShortcuts }: AppFooterProps) {
  return (
    <footer className="border-t border-market-500/10 py-6 text-center">
      <p className="text-amber-900 text-sm font-body">
        Open source · MIT License ·{" "}
        <button
          type="button"
          onClick={onOpenShortcuts}
          className="text-market-400 hover:text-market-300 underline underline-offset-2"
        >
          Shortcuts
        </button>
      </p>
    </footer>
  );
}
