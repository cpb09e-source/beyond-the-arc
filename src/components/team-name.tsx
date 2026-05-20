import { teamShortName } from "@/lib/team-names";

/**
 * Responsive team-name renderer. Below the `sm` breakpoint (640px) renders
 * the short form ("UConn"); at sm+ renders the canonical name ("Connecticut").
 *
 * If no short form exists for the name, renders the canonical name in both
 * breakpoints (no extra DOM cost — early return).
 *
 * Usage: <TeamName name={team.name} />
 *
 * For places where you need a single string (alt text, title attribute, etc.)
 * keep using the raw name — this component is for visible text only.
 */
export function TeamName({ name, className }: { name: string; className?: string }) {
  const short = teamShortName(name);
  if (short === name) {
    return className ? <span className={className}>{name}</span> : <>{name}</>;
  }
  return (
    <>
      <span className={`sm:hidden${className ? " " + className : ""}`}>{short}</span>
      <span className={`hidden sm:inline${className ? " " + className : ""}`}>{name}</span>
    </>
  );
}
