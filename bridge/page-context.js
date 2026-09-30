(() => {
  'use strict';
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.type !== 'SGC_REQUEST_PAGE_CONTEXT' || typeof data.requestId !== 'string') return;
    const steamId = window.g_steamID || window.g_strSteamID || window.g_rgProfileData?.steamid;
    window.postMessage({
      type: 'SGC_PAGE_CONTEXT',
      requestId: data.requestId,
      steamId: steamId ? String(steamId) : null
    }, location.origin);
  });
})();
