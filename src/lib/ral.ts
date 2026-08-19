/**
 * RAL Classic cross-reference (Phase 0.17, Tyler 8/19).
 *
 * "Can we see an RAL cross as they pick the color?" — the customer picks any
 * screen color; `nearestRal` names the closest RAL Classic shade live, and
 * the picker offers a one-click snap to that shade so the preview shows the
 * paint they will actually get (the quote matches to a real RAL either way).
 *
 * The hex values are the widely-published sRGB APPROXIMATIONS of the RAL
 * Classic palette — RAL is a physical paint standard, not an RGB system, so
 * these are screen stand-ins, which is exactly what the picker disclaimer
 * says. Distance is CIE76 ΔE in Lab space: adequate for "closest shade" at
 * palette granularity (the palette spacing is far coarser than CIE76's
 * perceptual error).
 */

export interface RalColor {
  /** RAL Classic number, e.g. "3020". */
  ral: string
  /** Official English name, e.g. "Traffic red". */
  name: string
  /** sRGB approximation. */
  hex: string
}

// The RAL Classic palette (community-standard sRGB approximations).
export const RAL_CLASSIC: RalColor[] = [
  { ral: '1000', name: 'Green beige', hex: '#BEBD7F' },
  { ral: '1001', name: 'Beige', hex: '#C2B078' },
  { ral: '1002', name: 'Sand yellow', hex: '#C6A664' },
  { ral: '1003', name: 'Signal yellow', hex: '#E5BE01' },
  { ral: '1004', name: 'Golden yellow', hex: '#CDA434' },
  { ral: '1005', name: 'Honey yellow', hex: '#A98307' },
  { ral: '1006', name: 'Maize yellow', hex: '#E4A010' },
  { ral: '1007', name: 'Daffodil yellow', hex: '#DC9D00' },
  { ral: '1011', name: 'Brown beige', hex: '#8A6642' },
  { ral: '1012', name: 'Lemon yellow', hex: '#C7B446' },
  { ral: '1013', name: 'Oyster white', hex: '#EAE6CA' },
  { ral: '1014', name: 'Ivory', hex: '#E1CC4F' },
  { ral: '1015', name: 'Light ivory', hex: '#E6D690' },
  { ral: '1016', name: 'Sulfur yellow', hex: '#EDFF21' },
  { ral: '1017', name: 'Saffron yellow', hex: '#F5D033' },
  { ral: '1018', name: 'Zinc yellow', hex: '#F8F32B' },
  { ral: '1019', name: 'Grey beige', hex: '#9E9764' },
  { ral: '1020', name: 'Olive yellow', hex: '#999950' },
  { ral: '1021', name: 'Rape yellow', hex: '#F3DA0B' },
  { ral: '1023', name: 'Traffic yellow', hex: '#FAD201' },
  { ral: '1024', name: 'Ochre yellow', hex: '#AEA04B' },
  { ral: '1027', name: 'Curry', hex: '#9D9101' },
  { ral: '1028', name: 'Melon yellow', hex: '#F4A900' },
  { ral: '1032', name: 'Broom yellow', hex: '#D6AE01' },
  { ral: '1033', name: 'Dahlia yellow', hex: '#F3A505' },
  { ral: '1034', name: 'Pastel yellow', hex: '#EFA94A' },
  { ral: '1035', name: 'Pearl beige', hex: '#6A5D4D' },
  { ral: '1036', name: 'Pearl gold', hex: '#705335' },
  { ral: '1037', name: 'Sun yellow', hex: '#F39F18' },
  { ral: '2000', name: 'Yellow orange', hex: '#ED760E' },
  { ral: '2001', name: 'Red orange', hex: '#C93C20' },
  { ral: '2002', name: 'Vermilion', hex: '#CB2821' },
  { ral: '2003', name: 'Pastel orange', hex: '#FF7514' },
  { ral: '2004', name: 'Pure orange', hex: '#F44611' },
  { ral: '2005', name: 'Luminous orange', hex: '#FF2301' },
  { ral: '2007', name: 'Luminous bright orange', hex: '#FFA420' },
  { ral: '2008', name: 'Bright red orange', hex: '#F75E25' },
  { ral: '2009', name: 'Traffic orange', hex: '#F54021' },
  { ral: '2010', name: 'Signal orange', hex: '#D84B20' },
  { ral: '2011', name: 'Deep orange', hex: '#EC7C26' },
  { ral: '2012', name: 'Salmon orange', hex: '#E55137' },
  { ral: '2013', name: 'Pearl orange', hex: '#C35831' },
  { ral: '3000', name: 'Flame red', hex: '#AF2B1E' },
  { ral: '3001', name: 'Signal red', hex: '#A52019' },
  { ral: '3002', name: 'Carmine red', hex: '#A2231D' },
  { ral: '3003', name: 'Ruby red', hex: '#9B111E' },
  { ral: '3004', name: 'Purple red', hex: '#75151E' },
  { ral: '3005', name: 'Wine red', hex: '#5E2129' },
  { ral: '3007', name: 'Black red', hex: '#412227' },
  { ral: '3009', name: 'Oxide red', hex: '#642424' },
  { ral: '3011', name: 'Brown red', hex: '#781F19' },
  { ral: '3012', name: 'Beige red', hex: '#C1876B' },
  { ral: '3013', name: 'Tomato red', hex: '#A12312' },
  { ral: '3014', name: 'Antique pink', hex: '#D36E70' },
  { ral: '3015', name: 'Light pink', hex: '#EA899A' },
  { ral: '3016', name: 'Coral red', hex: '#B32821' },
  { ral: '3017', name: 'Rose', hex: '#E63244' },
  { ral: '3018', name: 'Strawberry red', hex: '#D53032' },
  { ral: '3020', name: 'Traffic red', hex: '#CC0605' },
  { ral: '3022', name: 'Salmon pink', hex: '#D95030' },
  { ral: '3024', name: 'Luminous red', hex: '#F80000' },
  { ral: '3026', name: 'Luminous bright red', hex: '#FE0000' },
  { ral: '3027', name: 'Raspberry red', hex: '#C51D34' },
  { ral: '3028', name: 'Pure red', hex: '#CB3234' },
  { ral: '3031', name: 'Orient red', hex: '#B32428' },
  { ral: '3032', name: 'Pearl ruby red', hex: '#721422' },
  { ral: '3033', name: 'Pearl pink', hex: '#B44C43' },
  { ral: '4001', name: 'Red lilac', hex: '#6D3F5B' },
  { ral: '4002', name: 'Red violet', hex: '#922B3E' },
  { ral: '4003', name: 'Heather violet', hex: '#DE4C8A' },
  { ral: '4004', name: 'Claret violet', hex: '#641C34' },
  { ral: '4005', name: 'Blue lilac', hex: '#6C4675' },
  { ral: '4006', name: 'Traffic purple', hex: '#A03472' },
  { ral: '4007', name: 'Purple violet', hex: '#4A192C' },
  { ral: '4008', name: 'Signal violet', hex: '#924E7D' },
  { ral: '4009', name: 'Pastel violet', hex: '#A18594' },
  { ral: '4010', name: 'Telemagenta', hex: '#CF3476' },
  { ral: '4011', name: 'Pearl violet', hex: '#8673A1' },
  { ral: '4012', name: 'Pearl blackberry', hex: '#6C6874' },
  { ral: '5000', name: 'Violet blue', hex: '#354D73' },
  { ral: '5001', name: 'Green blue', hex: '#1F3438' },
  { ral: '5002', name: 'Ultramarine blue', hex: '#20214F' },
  { ral: '5003', name: 'Sapphire blue', hex: '#1D1E33' },
  { ral: '5004', name: 'Black blue', hex: '#18171C' },
  { ral: '5005', name: 'Signal blue', hex: '#1E2460' },
  { ral: '5007', name: 'Brilliant blue', hex: '#3E5F8A' },
  { ral: '5008', name: 'Grey blue', hex: '#26252D' },
  { ral: '5009', name: 'Azure blue', hex: '#025669' },
  { ral: '5010', name: 'Gentian blue', hex: '#0E294B' },
  { ral: '5011', name: 'Steel blue', hex: '#231A24' },
  { ral: '5012', name: 'Light blue', hex: '#3B83BD' },
  { ral: '5013', name: 'Cobalt blue', hex: '#1E213D' },
  { ral: '5014', name: 'Pigeon blue', hex: '#606E8C' },
  { ral: '5015', name: 'Sky blue', hex: '#2271B3' },
  { ral: '5017', name: 'Traffic blue', hex: '#063971' },
  { ral: '5018', name: 'Turquoise blue', hex: '#3F888F' },
  { ral: '5019', name: 'Capri blue', hex: '#1B5583' },
  { ral: '5020', name: 'Ocean blue', hex: '#1D334A' },
  { ral: '5021', name: 'Water blue', hex: '#256D7B' },
  { ral: '5022', name: 'Night blue', hex: '#252850' },
  { ral: '5023', name: 'Distant blue', hex: '#49678D' },
  { ral: '5024', name: 'Pastel blue', hex: '#5D9B9B' },
  { ral: '5025', name: 'Pearl gentian blue', hex: '#2A6478' },
  { ral: '5026', name: 'Pearl night blue', hex: '#102C54' },
  { ral: '6000', name: 'Patina green', hex: '#316650' },
  { ral: '6001', name: 'Emerald green', hex: '#287233' },
  { ral: '6002', name: 'Leaf green', hex: '#2D572C' },
  { ral: '6003', name: 'Olive green', hex: '#424632' },
  { ral: '6004', name: 'Blue green', hex: '#1F3A3D' },
  { ral: '6005', name: 'Moss green', hex: '#2F4538' },
  { ral: '6006', name: 'Grey olive', hex: '#3E3B32' },
  { ral: '6007', name: 'Bottle green', hex: '#343B29' },
  { ral: '6008', name: 'Brown green', hex: '#39352A' },
  { ral: '6009', name: 'Fir green', hex: '#31372B' },
  { ral: '6010', name: 'Grass green', hex: '#35682D' },
  { ral: '6011', name: 'Reseda green', hex: '#587246' },
  { ral: '6012', name: 'Black green', hex: '#343E40' },
  { ral: '6013', name: 'Reed green', hex: '#6C7156' },
  { ral: '6014', name: 'Yellow olive', hex: '#47402E' },
  { ral: '6015', name: 'Black olive', hex: '#3B3C36' },
  { ral: '6016', name: 'Turquoise green', hex: '#1E5945' },
  { ral: '6017', name: 'May green', hex: '#4C9141' },
  { ral: '6018', name: 'Yellow green', hex: '#57A639' },
  { ral: '6019', name: 'Pastel green', hex: '#BDECB6' },
  { ral: '6020', name: 'Chrome green', hex: '#2E3A23' },
  { ral: '6021', name: 'Pale green', hex: '#89AC76' },
  { ral: '6022', name: 'Olive drab', hex: '#25221B' },
  { ral: '6024', name: 'Traffic green', hex: '#308446' },
  { ral: '6025', name: 'Fern green', hex: '#3D642D' },
  { ral: '6026', name: 'Opal green', hex: '#015D52' },
  { ral: '6027', name: 'Light green', hex: '#84C3BE' },
  { ral: '6028', name: 'Pine green', hex: '#2C5545' },
  { ral: '6029', name: 'Mint green', hex: '#20603D' },
  { ral: '6032', name: 'Signal green', hex: '#317F43' },
  { ral: '6033', name: 'Mint turquoise', hex: '#497E76' },
  { ral: '6034', name: 'Pastel turquoise', hex: '#7FB5B5' },
  { ral: '6035', name: 'Pearl green', hex: '#1C542D' },
  { ral: '6036', name: 'Pearl opal green', hex: '#193737' },
  { ral: '6037', name: 'Pure green', hex: '#008F39' },
  { ral: '6038', name: 'Luminous green', hex: '#00BB2D' },
  { ral: '7000', name: 'Squirrel grey', hex: '#78858B' },
  { ral: '7001', name: 'Silver grey', hex: '#8A9597' },
  { ral: '7002', name: 'Olive grey', hex: '#7E7B52' },
  { ral: '7003', name: 'Moss grey', hex: '#6C7059' },
  { ral: '7004', name: 'Signal grey', hex: '#969992' },
  { ral: '7005', name: 'Mouse grey', hex: '#646B63' },
  { ral: '7006', name: 'Beige grey', hex: '#6D6552' },
  { ral: '7008', name: 'Khaki grey', hex: '#6A5F31' },
  { ral: '7009', name: 'Green grey', hex: '#4D5645' },
  { ral: '7010', name: 'Tarpaulin grey', hex: '#4C514A' },
  { ral: '7011', name: 'Iron grey', hex: '#434B4D' },
  { ral: '7012', name: 'Basalt grey', hex: '#4E5754' },
  { ral: '7013', name: 'Brown grey', hex: '#464531' },
  { ral: '7015', name: 'Slate grey', hex: '#434750' },
  { ral: '7016', name: 'Anthracite grey', hex: '#293133' },
  { ral: '7021', name: 'Black grey', hex: '#23282B' },
  { ral: '7022', name: 'Umbra grey', hex: '#332F2C' },
  { ral: '7023', name: 'Concrete grey', hex: '#686C5E' },
  { ral: '7024', name: 'Graphite grey', hex: '#474A51' },
  { ral: '7026', name: 'Granite grey', hex: '#2F353B' },
  { ral: '7030', name: 'Stone grey', hex: '#8B8C7A' },
  { ral: '7031', name: 'Blue grey', hex: '#474B4E' },
  { ral: '7032', name: 'Pebble grey', hex: '#B8B799' },
  { ral: '7033', name: 'Cement grey', hex: '#7D8471' },
  { ral: '7034', name: 'Yellow grey', hex: '#8F8B66' },
  { ral: '7035', name: 'Light grey', hex: '#D7D7D7' },
  { ral: '7036', name: 'Platinum grey', hex: '#7F7679' },
  { ral: '7037', name: 'Dusty grey', hex: '#7D7F7D' },
  { ral: '7038', name: 'Agate grey', hex: '#B5B8B1' },
  { ral: '7039', name: 'Quartz grey', hex: '#6C6960' },
  { ral: '7040', name: 'Window grey', hex: '#9DA1AA' },
  { ral: '7042', name: 'Traffic grey A', hex: '#8D948D' },
  { ral: '7043', name: 'Traffic grey B', hex: '#4E5452' },
  { ral: '7044', name: 'Silk grey', hex: '#CAC4B0' },
  { ral: '7045', name: 'Telegrey 1', hex: '#909090' },
  { ral: '7046', name: 'Telegrey 2', hex: '#82898F' },
  { ral: '7047', name: 'Telegrey 4', hex: '#D0D0D0' },
  { ral: '7048', name: 'Pearl mouse grey', hex: '#898176' },
  { ral: '8000', name: 'Green brown', hex: '#826C34' },
  { ral: '8001', name: 'Ochre brown', hex: '#955F20' },
  { ral: '8002', name: 'Signal brown', hex: '#6C3B2A' },
  { ral: '8003', name: 'Clay brown', hex: '#734222' },
  { ral: '8004', name: 'Copper brown', hex: '#8E402A' },
  { ral: '8007', name: 'Fawn brown', hex: '#59351F' },
  { ral: '8008', name: 'Olive brown', hex: '#6F4F28' },
  { ral: '8011', name: 'Nut brown', hex: '#5B3A29' },
  { ral: '8012', name: 'Red brown', hex: '#592321' },
  { ral: '8014', name: 'Sepia brown', hex: '#382C1E' },
  { ral: '8015', name: 'Chestnut brown', hex: '#633A34' },
  { ral: '8016', name: 'Mahogany brown', hex: '#4C2F27' },
  { ral: '8017', name: 'Chocolate brown', hex: '#45322E' },
  { ral: '8019', name: 'Grey brown', hex: '#403A3A' },
  { ral: '8022', name: 'Black brown', hex: '#212121' },
  { ral: '8023', name: 'Orange brown', hex: '#A65E2E' },
  { ral: '8024', name: 'Beige brown', hex: '#79553D' },
  { ral: '8025', name: 'Pale brown', hex: '#755C48' },
  { ral: '8028', name: 'Terra brown', hex: '#4E3B31' },
  { ral: '8029', name: 'Pearl copper', hex: '#763C28' },
  { ral: '9001', name: 'Cream', hex: '#FDF4E3' },
  { ral: '9002', name: 'Grey white', hex: '#E7EBDA' },
  { ral: '9003', name: 'Signal white', hex: '#F4F4F4' },
  { ral: '9004', name: 'Signal black', hex: '#282828' },
  { ral: '9005', name: 'Jet black', hex: '#0A0A0A' },
  { ral: '9006', name: 'White aluminium', hex: '#A5A5A5' },
  { ral: '9007', name: 'Grey aluminium', hex: '#8F8F8F' },
  { ral: '9010', name: 'Pure white', hex: '#FFFFFF' },
  { ral: '9011', name: 'Graphite black', hex: '#1C1C1C' },
  { ral: '9016', name: 'Traffic white', hex: '#F6F6F6' },
  { ral: '9017', name: 'Traffic black', hex: '#1E1E1E' },
  { ral: '9018', name: 'Papyrus white', hex: '#D7D7D7' },
  { ral: '9022', name: 'Pearl light grey', hex: '#9C9C9C' },
  { ral: '9023', name: 'Pearl dark grey', hex: '#828282' },
]

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** sRGB → CIE Lab (D65), for perceptual nearest-shade matching. */
function rgbToLab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const [rl, gl, bl] = [lin(r), lin(g), lin(b)]
  // sRGB D65 matrix
  const x = (0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047
  const y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
  const z = (0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** The closest RAL Classic shade to a hex color (CIE76 ΔE in Lab). */
export function nearestRal(hex: string): RalColor {
  if (!/^#?[0-9a-fA-F]{6}$/.test(hex)) return RAL_CLASSIC[0]
  const target = rgbToLab(hexToRgb(hex.startsWith('#') ? hex : `#${hex}`))
  let best = RAL_CLASSIC[0]
  let bestD = Infinity
  for (const c of RAL_CLASSIC) {
    const lab = rgbToLab(hexToRgb(c.hex))
    const d =
      (lab[0] - target[0]) ** 2 + (lab[1] - target[1]) ** 2 + (lab[2] - target[2]) ** 2
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}
