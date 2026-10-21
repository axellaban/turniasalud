// Normaliza teléfonos al formato de ID de WhatsApp: solo dígitos, con código
// de país. En Argentina los celulares en WhatsApp llevan "549" + área + número
// (sin el 0 del área ni el 15 del celular).

export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  // IDs que no son teléfonos (demo web, BSUID de WhatsApp) se dejan tal cual.
  if (/[a-z]/i.test(trimmed)) return trimmed;

  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("00")) digits = digits.slice(2);

  if (digits.startsWith("54")) {
    let rest = digits.slice(2);
    if (rest.startsWith("9")) rest = rest.slice(1);
    rest = stripArgentineMobilePrefix(rest);
    return `549${rest}`;
  }

  // Número local argentino: 011 15 5555-0001, 11 5555 0001, 0351 15 555 0001…
  if (digits.length >= 10 && digits.length <= 13) {
    if (digits.startsWith("0")) digits = digits.slice(1);
    return `549${stripArgentineMobilePrefix(digits)}`;
  }
  return digits;
}

function stripArgentineMobilePrefix(national: string): string {
  // El "15" va después del código de área (2 a 4 dígitos). Si sacarlo deja un
  // número nacional de 10 dígitos, era el prefijo de celular.
  for (const areaLen of [2, 3, 4]) {
    if (national.slice(areaLen, areaLen + 2) === "15" && national.length - 2 === 10) {
      return national.slice(0, areaLen) + national.slice(areaLen + 2);
    }
  }
  return national;
}

export function displayPhone(id: string | null | undefined): string {
  if (!id) return "—";
  if (/^549\d{10}$/.test(id)) {
    const n = id.slice(3);
    return `+54 9 ${n.slice(0, 2)} ${n.slice(2, 6)}-${n.slice(6)}`;
  }
  return /^\d+$/.test(id) ? `+${id}` : id;
}
