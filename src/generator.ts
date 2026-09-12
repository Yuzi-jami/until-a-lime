export const characterGroups = {
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{}:,.?",
};
export type CharacterGroup = keyof typeof characterGroups;
export type GeneratorOptions = {
  length: number;
  excludeAmbiguous: boolean;
} & Record<CharacterGroup, boolean>;
export const defaultGeneratorOptions: GeneratorOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: true,
};
export function generatePassword(options: GeneratorOptions): string {
  if (
    !Number.isInteger(options.length) ||
    options.length < 8 ||
    options.length > 64
  )
    throw new Error("长度应为 8–64 个字符。");
  const groups = (Object.keys(characterGroups) as CharacterGroup[])
    .filter((key) => options[key])
    .map((key) =>
      options.excludeAmbiguous
        ? characterGroups[key].replace(/[Il1O0o|]/g, "")
        : characterGroups[key],
    );
  if (!groups.length) throw new Error("至少选择一种字符类型。");
  const alphabet = groups.join(""),
    limit = Math.floor(256 / alphabet.length) * alphabet.length;
  // Sample uniformly, then reject entire candidates missing a selected group.
  // This avoids bias from inserting mandatory characters into fixed positions.
  for (let attempt = 0; attempt < 1024; attempt++) {
    let result = "";
    while (result.length < options.length) {
      for (const byte of crypto.getRandomValues(new Uint8Array(128))) {
        if (byte < limit) result += alphabet[byte % alphabet.length];
        if (result.length === options.length) break;
      }
    }
    if (
      groups.every((group) => [...result].some((char) => group.includes(char)))
    )
      return result;
  }
  throw new Error("本次生成未完成，请重试。");
}
