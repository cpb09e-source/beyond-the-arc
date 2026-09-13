import photoMap from "@/data/player-photos.json";
import type { RecordRef } from "~/shell/views";

const PHOTOS = photoMap as Record<string, unknown>;

/** Whether the app has a headshot for a player, by the same map the Player Explorer reads. */
export const hasPhotoFor = (bartId: number | null): boolean => bartId != null && PHOTOS[String(bartId)] != null;

/** A portal player as a record a tab can open, when the site knows who he is. */
export function playerRecord(p: { bart_player_id: number | null; name: string }): RecordRef | null {
  return p.bart_player_id == null
    ? null
    : { kind: "player", bartId: p.bart_player_id, name: p.name, hasPhoto: hasPhotoFor(p.bart_player_id) };
}
