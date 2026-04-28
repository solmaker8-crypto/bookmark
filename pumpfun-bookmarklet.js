javascript: (async function() {
  const SNIPER_URL = 'https://cdn.jsdelivr.net/gh/solmaker8-crypto/bookmark@a287965/pumpfun-sniper.js?v=' + Date.now();
  
  try {
    const code = await fetch(SNIPER_URL).then(r => r.text());
    const script = document.createElement('script');
    script.textContent = code;
    document.head.appendChild(script);
  } catch(e) {
    alert('❌ Failed to load sniper: ' + e.message);
  }
})();
