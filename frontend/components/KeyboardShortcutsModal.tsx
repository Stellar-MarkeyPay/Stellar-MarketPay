import { useEffect, useRef } from "react";

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-market-500/25 bg-ink-800 px-2 py-1 text-xs font-semibold text-market-300">
      {children}
    </kbd>
  );
}

export default function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const onTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onTab);
    return () => {
      document.removeEventListener("keydown", onTab);
      previousActiveElement?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const shortcuts = [
    { keys: ["G"], description: "Go to Jobs listing" },
    { keys: ["D"], description: "Go to Dashboard" },
    { keys: ["P"], description: "Post a new job" },
    { keys: ["?"], description: "Show this shortcut guide" },
    { keys: ["Esc"], description: "Close modal / dialog" },
    { keys: ["/"], description: "Focus search bar" },
    { keys: ["B"], description: "Toggle bookmark on focused job" },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close keyboard shortcuts"
        onClick={onClose}
      />

      <div
        ref={dialogRef}
        className="relative w-full max-w-xl rounded-2xl border border-market-500/20 bg-ink-900 p-6 shadow-2xl"
        aria-describedby="shortcuts-description"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="shortcuts-title" className="font-display text-xl font-bold text-amber-100">
            Keyboard Shortcuts
          </h2>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="btn-ghost px-3 py-1 text-xs">
            Close
          </button>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-market-500/10 text-left text-xs uppercase tracking-wide text-amber-800">
              <th className="pb-2 pr-4">Key</th>
              <th className="pb-2">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-market-500/10">
            {shortcuts.map((row) => (
              <tr key={row.description}>
                <td className="py-2.5 pr-4">
                  <Key>{row.keys[0]}</Key>
                </td>
                <td className="py-2.5 text-amber-200/90">{row.description}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p id="shortcuts-description" className="mt-5 text-xs text-amber-800">
          Shortcuts are disabled while typing in form fields.
        </p>
      </div>
    </div>
  );
}
