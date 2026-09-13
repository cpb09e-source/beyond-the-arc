import { viewById, type RecordRef } from "~/shell/views";
import { CoachAvatar } from "~/ui/coach-avatar";
import { TeamLogo } from "~/ui/logo";
import { PlayerPhoto } from "~/ui/player-photo";

/**
 * What a place wears wherever it is listed: a tab, a Recent row in Ctrl K.
 * A team's crest, a player's face, a game's two crests, otherwise the view's icon.
 */
export function PlaceMark({ viewId, record, size = 15, muted = true }: { viewId: string; record?: RecordRef; size?: number; muted?: boolean }) {
  if (record?.kind === "team") return <TeamLogo id={record.logoId} name={record.name} size={size} />;
  if (record?.kind === "player") return <PlayerPhoto bartId={record.bartId} hasPhoto={record.hasPhoto} name={record.name} size={size + 1} />;
  if (record?.kind === "coach") return <CoachAvatar name={record.name} team={record.team} size={size + 1} />;
  if (record?.kind === "game") {
    return (
      <span className="flex shrink-0 items-center">
        <TeamLogo id={record.awayLogo} name={record.away} size={size - 1} />
        <span className="-ml-1">
          <TeamLogo id={record.homeLogo} name={record.home} size={size - 1} />
        </span>
      </span>
    );
  }
  const Icon = viewById(viewId).icon;
  return <Icon size={size - 1} strokeWidth={2} className={`shrink-0 ${muted ? "text-ink-muted" : "text-ink-soft"}`} />;
}
