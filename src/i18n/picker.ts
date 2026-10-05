import { getLocale, isLocale, onLocaleChange, setLocale, type Locale } from "./index";

/**
 * The language controls: the buttons on the title screen (`[data-lang]`, each language named in
 * itself) and the select in 設定 (`#opt-lang`). Either switches at once and is remembered; both
 * show the language in force.
 */
export function bindLanguagePickers(root: ParentNode = document): void {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("button[data-lang]")];
  const select = root.querySelector<HTMLSelectElement>("#opt-lang");
  for (const b of buttons) {
    b.addEventListener("click", () => {
      const lang = b.dataset.lang;
      if (isLocale(lang)) setLocale(lang);
    });
  }
  select?.addEventListener("change", () => {
    if (isLocale(select.value)) setLocale(select.value);
  });

  const show = (locale: Locale) => {
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.lang === locale));
    if (select) select.value = locale;
  };
  onLocaleChange(show);
  show(getLocale());
}
