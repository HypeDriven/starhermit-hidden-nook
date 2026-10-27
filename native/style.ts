// The look of the menus, HUD and rails: the browser build's style sheet,
// rewritten class-based in tools/ui-style.css and converted once with
// `starhermit css` into assets/ui-style.json (`npm run css`), registered at
// start, plus the built-in widgets' looks (dialogs as the dark overlay
// panels, checkboxes, selects, text fields, the progress bar, scroll bars)
// in the same palette. High contrast and larger text are the runtime's (it
// forces the UI's colours and scales its text).
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

export const COLORS = {
  bg: "#0f1420", main: "#131a29", panel: "#1a2333", panel2: "#222e44", line: "#2c3a4f", accent: "#ffb84d",
  good: "#7dd87d", bad: "#e26a6a", text: "#f5f7fa", dim: "#c3ccd8", field: "#0d1420",
};

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setTheme({
    fontSize: 16, smallSize: 14, headingSize: 20, padding: 8, spacing: 8, radius: 8,
    text: COLORS.text, muted: COLORS.dim, panel: COLORS.panel, control: COLORS.panel2, hovered: "#2a3852",
    pressed: "#1c2638", field: COLORS.field, accent: COLORS.accent, focus: COLORS.accent, outline: COLORS.line,
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: COLORS.text } },
    paragraph: { text: { color: COLORS.text } },
    heading: { text: { color: COLORS.accent } },
    widget: { focusRing: { color: COLORS.accent, width: 3, offset: 2 } },
    checkbox: {
      text: { color: COLORS.text }, minHeight: 44,
      parts: { box: { background: COLORS.panel2, border: { width: 1, color: COLORS.line }, radius: 4 }, mark: { background: COLORS.accent } },
    },
    select: { text: { color: COLORS.text }, background: COLORS.panel2, border: { width: 1, color: COLORS.line }, radius: 6, minHeight: 40 },
    textField: { text: { color: COLORS.text }, background: COLORS.panel2, border: { width: 1, color: COLORS.line }, radius: 6, minHeight: 40 },
    dialog: {
      background: COLORS.panel, radius: 12, padding: 20, border: { width: 1, color: COLORS.line }, shadow: { y: 18, blur: 60, color: "#00000080" },
      parts: { backdrop: { background: "#080c14b8" } },
    },
    progress: { minHeight: 8, radius: 4, parts: { track: { background: COLORS.field, radius: 4 }, fill: { background: COLORS.accent, radius: 4 } } },
    scrollArea: { parts: { bar: { background: "#4a5a72", radius: 4 } } },
    tooltip: { background: COLORS.panel2, text: { color: COLORS.text }, radius: 6, padding: 6 },
  });
}
