import React from "react";

export type ToastItem = { id: string; title: string; message: string };

export function ToastArea({ items }: { items: ToastItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="toastwrap" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          <strong>{t.title}</strong>
          <p>{t.message}</p>
        </div>
      ))}
    </div>
  );
}

export function useToasts() {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const push = React.useCallback((title: string, message: string) => {
    const id = crypto.randomUUID();
    setItems((prev) => [...prev, { id, title, message }]);
    window.setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 2600);
  }, []);
  return { items, push };
}
