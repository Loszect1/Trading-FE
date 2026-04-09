"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface ToastItem {
  id: number;
  message: string;
  variant: "success" | "error" | "info";
}

interface ToastContextValue {
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, variant: "success" | "error" | "info" = "info") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, message, variant }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 2200);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[380px] max-w-[calc(100vw-1.5rem)] flex-col gap-3">
        {toasts.map((toast) => (
          (() => {
            const variantClasses =
              toast.variant === "success"
                ? "border-emerald-300/80 bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-950 text-emerald-50"
                : toast.variant === "error"
                  ? "border-rose-300/80 bg-gradient-to-br from-rose-950 via-rose-900 to-rose-950 text-rose-50"
                  : "border-sky-300/80 bg-gradient-to-br from-sky-950 via-sky-900 to-sky-950 text-sky-50";

            const icon = toast.variant === "success" ? "OK" : toast.variant === "error" ? "ER" : "IN";

            return (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl border px-4 py-3 text-sm leading-5 shadow-2xl backdrop-blur ${variantClasses}`}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/10 text-[10px] font-bold tracking-wide">
                {icon}
              </span>
              <p className="font-medium">{toast.message}</p>
            </div>
          </div>
            );
          })()
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
