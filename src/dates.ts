// Date.parse también acepta "1" y normaliza fechas imposibles como 30 de
// febrero. El backend usa RFC3339: validamos el calendario antes de convertir.
export const date = (
  value: unknown,
  allowDateOnly = false,
): value is string => {
  if (typeof value !== "string" || value.length > 40) return false;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?([Zz]|[+-]\d{2}:\d{2}))?$/.exec(
      value,
    );
  if (!parts) return false;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    zone,
  ] = parts;
  const year = Number(yearText),
    month = Number(monthText),
    day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return false;
  if (hourText === undefined) return allowDateOnly;
  if (
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59
  )
    return false;
  if (
    zone !== "Z" &&
    zone !== "z" &&
    (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)
  )
    return false;
  return Number.isFinite(Date.parse(value));
};
