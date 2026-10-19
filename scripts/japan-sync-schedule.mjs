const formatter = (timeZone) => new Intl.DateTimeFormat("en-CA", {
  timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function validateTimeZone(timeZone) {
  formatter(timeZone).format(new Date());
  return timeZone;
}

export function nextDailyRun(now, hour, minute, timeZone) {
  const partsFor = formatter(validateTimeZone(timeZone));
  let timestamp = Math.floor(now.getTime() / 60_000) * 60_000 + 60_000;
  // Twenty-seven hours covers the longest civil day around a daylight-saving transition.
  for (let offset = 0; offset < 27 * 60; offset += 1, timestamp += 60_000) {
    const parts = Object.fromEntries(partsFor.formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]));
    if (parts.hour === hour && parts.minute === minute) return new Date(timestamp);
  }
  throw new Error(`Could not find the next ${hour}:${String(minute).padStart(2, "0")} run in ${timeZone}.`);
}

export function describeRun(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
