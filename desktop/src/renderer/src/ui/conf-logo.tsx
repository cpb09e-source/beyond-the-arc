import { useState } from "react";

/**
 * A conference's mark, by the site's conference code ("B10", "SEC").
 *
 * The site's own 32 files (public/images/conf), served by the app's bta://
 * protocol and shipped with the installer. A missing mark leaves an empty box
 * of the same size rather than nothing, so names down a table still line up;
 * the name beside it already says which league this is.
 */
export function ConfLogo({ conf, size = 20 }: { conf: string; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === conf || !/^[A-Za-z0-9]{1,8}$/.test(conf)) {
    return <span aria-hidden className="shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <img
      src={`bta://conf/${conf}.png`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      draggable={false}
      onError={() => setFailed(conf)}
      className="conf-logo shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}
