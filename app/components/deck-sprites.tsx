type DeckSpritesProps = { icons: readonly string[] | null | undefined; compact?: boolean };

export function DeckSprites({ icons, compact = false }: DeckSpritesProps) {
  const safeIcons = (icons ?? []).filter((icon) => /^[a-z0-9-]{1,64}$/.test(icon)).slice(0, 3);
  if (!safeIcons.length) return null;

  return <span className="inline-flex shrink-0 items-center gap-0.5" aria-hidden="true">
    {safeIcons.map((icon, index) => icon === "substitute" ? <svg
      key={`${icon}-${index}`}
      viewBox="0 0 32 32"
      width={compact ? 24 : 32}
      height={compact ? 24 : 32}
      className="shrink-0"
      fill="none"
    >
      <rect x="3.5" y="3.5" width="19" height="24" rx="2.5" fill="#f4f3ed" stroke="#9bb2b5" />
      <rect x="7.5" y="5.5" width="19" height="24" rx="2.5" fill="#f7f8f4" stroke="#7e9da2" />
      <rect x="10.5" y="8.5" width="18" height="21" rx="2.5" fill="#e9f1ec" stroke="#27566a" strokeWidth="1.5" />
      <circle cx="15.5" cy="19" r="1.2" fill="#27566a" />
      <circle cx="19.5" cy="19" r="1.2" fill="#27566a" />
      <circle cx="23.5" cy="19" r="1.2" fill="#27566a" />
    </svg> : <img
      key={`${icon}-${index}`}
      src={`https://r2.limitlesstcg.net/pokemon/gen9/${icon}.png`}
      alt=""
      width={compact ? 24 : 32}
      height={compact ? 24 : 32}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={compact ? "h-6 w-6 object-contain" : "h-8 w-8 object-contain"}
    />)}
  </span>;
}
