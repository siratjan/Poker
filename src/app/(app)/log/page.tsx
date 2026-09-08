/**
 * Placeholder so the tab bar of the app shell has no dead link.
 * WP8 replaces this with the audit log view.
 */
export default function LogPage() {
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-lg font-semibold">Log</h1>
      <p className="text-sm opacity-70">Das Audit-Log wird in einem späteren Paket angezeigt.</p>
    </section>
  );
}
