/**
 * The look of 「つぶやき」, the game's fictional SNS: a dark timeline in the style people know from
 * the big microblogging apps (black ground, grey hairlines, one blue accent, pink likes, green
 * reposts). Shared by the feed UI (socialView) and the phone screens bystanders film with, so both
 * read as the same app.
 *
 * Why not a real app's logo, name or verification mark: they are trademarks. The layout and the
 * colours are a common idiom; the name and the logo below are the game's own.
 */
export const SOCIAL_APP_NAME = "つぶやき";

export const SOCIAL_THEME = {
  background: "#000000",
  surface: "#16181c",
  hairline: "#2f3336",
  text: "#e7e9ea",
  secondary: "#71767b",
  accent: "#1d9bf0",
  like: "#f91880",
  repost: "#00ba7c",
  /** The game's own badge for accounts the app vouches for (not a check in a rosette). */
  badge: "#ffd23c",
  font: '"Noto Sans JP", system-ui, sans-serif',
  /** Notifications the app recommends (what is trending near you). */
  notice: "#8b5cf6",
  /** Raised controls on the black ground: the search box, the media placeholder. */
  raised: "#202327",
} as const;

/**
 * The badge itself, in a 24×24 box: a rounded diamond (`shape`, filled with `badge`) with a tick
 * (`tick`, stroked in the background colour). Why a diamond: a check in a scalloped rosette is a
 * real app's verification mark.
 */
export const SOCIAL_BADGE_PATHS = {
  shape:
    "M13.56 3.06 20.94 10.44Q22.5 12 20.94 13.56L13.56 20.94Q12 22.5 10.44 20.94L3.06 13.56Q1.5 12 3.06 10.44L10.44 3.06Q12 1.5 13.56 3.06Z",
  tick: "M8.3 12.2l2.5 2.5 4.9-5.1",
} as const;

/**
 * The app's logo: a speech bubble with three dots, drawn in a 24×24 box (SVG path data), so it can be
 * used in the DOM (inline SVG) and on canvases (Path2D).
 */
export const SOCIAL_LOGO_PATH =
  "M12 3C6.48 3 2 6.94 2 11.8c0 2.6 1.29 4.94 3.35 6.55L4.5 21.5l3.9-1.86c1.12.32 2.33.5 3.6.5 5.52 0 10-3.94 10-8.84S17.52 3 12 3Zm-4.5 10.2a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Zm4.5 0a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Zm4.5 0a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Z";
