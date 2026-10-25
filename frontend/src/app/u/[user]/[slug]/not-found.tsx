export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-[420px] rounded-3xl border border-line bg-card px-8 py-12 text-center">
        <div className="font-display text-2xl font-bold">Витрина не найдена</div>
        <p className="mt-2 text-sm text-muted">Ссылка устарела, или владелец отключил эту витрину.</p>
      </div>
    </div>
  );
}
