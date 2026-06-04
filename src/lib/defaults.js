// Cesar's acervo CAC (editable in app, persisted in localStorage)
export const DEFAULT_ACERVO = [
  { id: 'g25', arma: 'Glock G25', calibre: '.380 ACP' },
  { id: 'g28', arma: 'Glock G28', calibre: '.380 ACP' },
  { id: 'zion', arma: 'IWI Zion', calibre: '5.56 NATO' },
  { id: 'arad', arma: 'IWI Arad', calibre: '7.62 NATO' },
  { id: 'uzi', arma: 'IWI Uzi', calibre: '9mm Luger' },
  { id: 'shield', arma: 'M&P Shield', calibre: '9mm Luger' },
  { id: 'bodyguard', arma: 'S&W Bodyguard 2.0', calibre: '.380 ACP' },
  { id: 'mp12', arma: 'M&P 12 Series', calibre: '12 GA' },
  { id: 'p80', arma: 'Glock P80', calibre: '9mm Luger' },
  { id: 'sxp', arma: 'Winchester SXP', calibre: '12 GA' },
  { id: 'wildcat', arma: 'Winchester Wildcat', calibre: '.22 LR' },
  { id: 'bergara', arma: 'Bergara BMR X Carbon', calibre: '.22 LR' },
  { id: 'g27', arma: 'Glock G27', calibre: '.40 S&W' },
  { id: 'rt838', arma: 'Taurus RT 838', calibre: '.38 Special' },
]

export const DEFAULT_PRECOS = {
  '.380 ACP': 6.50,
  '9mm Luger': 8.50,
  '.40 S&W': 9.00,
  '.45 ACP': 12.00,
  '5.56 NATO': 14.00,
  '7.62 NATO': 25.00,
  '.22 LR': 2.50,
  '12 GA': 4.00,
  '.357 Magnum': 10.00,
  '.38 Special': 7.00,
}

export const DEFAULT_SETTINGS = {
  pixKey: '0579bee3-174c-4e46-8541-64f614fc5191',
  pixMerchant: 'SHOOTING RANGE',
  pixCity: 'SAO PAULO',
}

export const CALIBRES = Object.keys(DEFAULT_PRECOS)
