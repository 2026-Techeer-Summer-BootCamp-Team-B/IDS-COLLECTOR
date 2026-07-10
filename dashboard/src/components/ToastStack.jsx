import React from "react";

// Generic "action succeeded" feedback — separate from CriticalAlertPopup,
// which is specifically for incoming CRITICAL detections. Fires from
// App.jsx's `logAction` whenever a fake response action button is clicked.
export default function ToastStack({ toasts }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <div className="fixed bottom-20 right-6 z-50 flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`text-sm px-4 py-2.5 rounded-lg shadow-lg ${
            t.tone === "error" ? "bg-dash-critical text-white" : "bg-dash-mint text-dash-bg"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
