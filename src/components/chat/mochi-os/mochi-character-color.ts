export function getMochiCharacterColor(characterName: string): string {
  const key = characterName.trim().toLowerCase();
  const hue = Math.abs([...key].reduce((sum, character) => sum + character.charCodeAt(0), 0) * 47) % 360;
  return `hsl(${hue}, 28%, 46%)`;
}
