export default function TeamsPage() {
  return (
    <Placeholder
      kicker="02 · Team dossier"
      title="A page for every program"
      note="Coming next: select a team to see the full dossier — season line, shot chart, top lineups, on-off splits."
    />
  );
}

function Placeholder({
  kicker,
  title,
  note,
}: {
  kicker: string;
  title: string;
  note: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 lg:px-10 py-24">
      <span className="text-xs uppercase tracking-widest text-coral font-medium">
        {kicker}
      </span>
      <h1 className="font-display text-5xl md:text-6xl text-ink mt-4 mb-6 leading-tight">
        {title}
      </h1>
      <p className="text-lg text-ink-soft">{note}</p>
    </div>
  );
}
