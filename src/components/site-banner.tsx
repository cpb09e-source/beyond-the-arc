"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BannerView, type BannerContent } from "@/components/banner-view";

/**
 * The one thing that can be said to every reader without a deploy.
 *
 * WHY IT IS NOT A DATA FILE. Everything else the site reads at runtime comes
 * from R2 with an hour of cache, which is right for a season's numbers and
 * useless here: a banner announcing that tonight's scores are delayed is worth
 * nothing if it appears an hour after it is written. This reads site_config
 * straight from Supabase with the anon key, so it is live the moment it is
 * saved. The table has a public select policy for exactly this — the banner
 * has to reach signed-out readers, who are most of the audience.
 *
 * IT RENDERS NOTHING UNTIL IT KNOWS, and never renders a placeholder. Almost
 * every page load has no banner, so a reserved strip would be a permanent
 * empty band on a site that mostly has nothing to announce. Appearing a beat
 * late is the correct trade in the direction the odds run.
 *
 * A FAILED READ IS SILENT. Supabase being down should not put an error across
 * the top of every page on the site; the worst case of failing quiet is that
 * an announcement is missed, which is where this started.
 *
 * The look lives in BannerView, shared with the admin page's preview so the
 * two cannot drift.
 */

type Banner = BannerContent & { enabled: boolean };

export function SiteBanner() {
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    let live = true;
    supabase
      .from("site_config")
      .select("value")
      .eq("key", "banner")
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live || error || !data) return;
        const v = (data as { value: Banner | null }).value;
        if (v && v.enabled && v.message) setBanner(v);
      });
    return () => { live = false; };
  }, []);

  if (!banner) return null;
  // role="status" rather than "alert": this is information the reader may
  // want, not something demanding they stop. An alert interrupts a screen
  // reader mid-sentence, which is wrong for "previews are live".
  return (
    <div role="status">
      <BannerView banner={banner} />
    </div>
  );
}
