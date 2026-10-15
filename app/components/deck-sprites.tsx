type DeckSpritesProps = { icons: readonly string[] | null | undefined; compact?: boolean };

export function DeckSprites({ icons, compact = false }: DeckSpritesProps) {
  const safeIcons = (icons ?? []).filter((icon) => /^[a-z0-9-]{1,64}$/.test(icon)).slice(0, 3);
  if (!safeIcons.length) return null;

  return <span className="inline-flex shrink-0 items-center gap-0.5" aria-hidden="true">
    {safeIcons.map((icon, index) => <img
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
