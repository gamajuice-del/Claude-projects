// Shared colours for the map and interface.

/** 24 well-separated nation colours (RGB) */
export const CIV_COLORS: [number, number, number][] = [
  [226, 74, 74], [72, 132, 230], [240, 190, 60], [92, 196, 106], [196, 96, 220], [240, 132, 56], [70, 206, 206], [236, 110, 170],
  [150, 122, 240], [176, 208, 70], [214, 150, 110], [110, 160, 190], [250, 224, 130], [150, 80, 60], [60, 150, 130], [200, 60, 130],
  [120, 200, 250], [250, 160, 160], [130, 110, 70], [180, 180, 230], [90, 110, 220], [230, 230, 230], [255, 120, 90], [160, 230, 180],
];

export function civCss(color: number, alpha = 1): string {
  const c = CIV_COLORS[color % CIV_COLORS.length];
  return alpha >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

/** architecture styles: wall and roof colours per culture */
export const STYLES: { wall: [number, number, number]; roof: [number, number, number]; name: string }[] = [
  { wall: [206, 172, 128], roof: [164, 74, 54], name: 'timber and red tile' },
  { wall: [232, 228, 214], roof: [70, 118, 176], name: 'whitewash and blue tile' },
  { wall: [156, 152, 148], roof: [84, 80, 92], name: 'grey stone and slate' },
  { wall: [222, 196, 142], roof: [196, 128, 78], name: 'sandstone and terracotta' },
  { wall: [128, 98, 72], roof: [204, 178, 104], name: 'dark timber and thatch' },
];

export const BIOME_COLORS: [number, number, number][] = [
  [24, 62, 122], [56, 138, 176], [62, 150, 186], [214, 230, 240], [222, 206, 160], [236, 240, 246], [150, 150, 128], [58, 104, 80], [176, 166, 110],
  [118, 164, 82], [56, 118, 62], [70, 110, 90], [218, 196, 140], [176, 168, 92], [104, 136, 70], [34, 110, 62], [140, 132, 110], [128, 122, 118],
  [238, 242, 248], [200, 80, 50],
];

export const JOB_COLORS: [number, number, number][] = [
  [240, 220, 190], [150, 116, 70], [80, 150, 190], [116, 140, 80], [190, 170, 110], [120, 90, 60], [110, 110, 120], [200, 130, 70],
  [160, 90, 180], [200, 60, 60], [80, 110, 200], [240, 240, 235], [230, 190, 80], [130, 120, 110],
];

export const EVENT_COLORS: Record<string, string> = {
  war: '#ef6b5e', battle: '#ef6b5e', siege: '#ef6b5e', conquest: '#ef6b5e', rebellion: '#f0a35e', revolution: '#f0a35e', coup: '#f0a35e', uprising: '#f0a35e', riot: '#f0a35e',
  peace: '#7fd36b', treaty: '#7fd36b', union: '#7fd36b', diplomacy: '#9fc0e8', contact: '#9fc0e8', blockade: '#ef6b5e',
  tech: '#5fd0c5', era: '#5fd0c5', lost: '#9aa7b5', build: '#c9b48a', patron: '#c9b48a', merchant: '#f2b33d', golden: '#f2b33d',
  found: '#c9e08a', migration: '#c9e08a', ruin: '#9aa7b5', fall: '#b58cf5', decline: '#9aa7b5',
  famine: '#f0a35e', plague: '#b58cf5', drought: '#e0c070', flood: '#6fb4ea', fire: '#f08a4a', quake: '#c9a07a', volcano: '#f0603a', meteor: '#f0603a', blight: '#c0c060', climate: '#6fb4ea',
  succession: '#e9e4d4', government: '#e9e4d4', politics: '#e9e4d4', law: '#e9e4d4',
  religion: '#d6b6ff', culture: '#d6b6ff', tradition: '#d6b6ff', miracle: '#f2b33d', curse: '#b58cf5', smite: '#f2b33d',
  species: '#8fd0a0', extinct: '#9aa7b5', genesis: '#f2b33d', depleted: '#9aa7b5', death: '#9aa7b5',
};
