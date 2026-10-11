function getLibSite(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  const sites = [
    {id: 5, name: 'AnimeLib', kind: 'anime', domains: ['animelib.org','animelib.me']},
    {id: 3, name: 'RanobeLib', kind: 'novel', domains: ['ranobelib.me', 'ranobelib.org']},
    {id: 1, name: 'MangaLib', kind: 'manga', domains: ['mangalib.me', 'mangalib.org']},
    {id: 4, name: 'HentaiLib', kind: 'manga', domains: ['hentailib.me', 'hentailib.org']},
    {id: 2, name: 'SlashLib', kind: 'manga', domains: ['slashlib.me', 'slashlib.org', 'shlib.life']}
  ];
  return sites.find(site => site.domains.some(domain => host === domain || host.endsWith('.' + domain))) || null;
}
