module.exports = {
  // Czy proxy ma być włączone? (true = włączone, false = połącz bezpośrednio z Rendera)
  useProxy: true,

  // Dane serwera proxy SOCKS5
  proxyHost: '91.98.161.17', // np. '185.220.101.5'
  proxyPort: 1080,                   // np. 1080 (zmienia się w zależności od proxy)

  // Jeśli proxy wymaga logowania, wpisz dane poniżej (jeśli nie, zostaw null)
  proxyUsername: null,
  proxyPassword: null
};
