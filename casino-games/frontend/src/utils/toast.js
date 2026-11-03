let toasts = [];
const listeners = new Set();
const KEY = 'c888_toast_seq';

function nextId() {
  const seq = parseInt(localStorage.getItem(KEY) || '0', 10) + 1;
  localStorage.setItem(KEY, String(seq));
  return seq;
}

export function pushToast(message, type = 'info', ms = 4000) {
  const toast = { id: nextId(), message, type };
  toasts = [...toasts, toast];
  listeners.forEach((l) => l(toasts));
  setTimeout(() => dismissToast(toast.id), ms);
  return toast.id;
}

export function dismissToast(id) {
  toasts = toasts.filter((t) => t.id !== id);
  listeners.forEach((l) => l(toasts));
}

export function subscribeToasts(listener) {
  listeners.add(listener);
  listener(toasts);
  return () => listeners.delete(listener);
}