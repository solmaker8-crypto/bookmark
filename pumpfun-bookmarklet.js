javascript: (async function() {
  const SNIPER_URL = 'https://cdn.jsdelivr.net/gh/solmaker8-crypto/bookmark@main/pumpfun-sniper.js';
  
  try {
    const code = await fetch(SNIPER_URL).then(r => r.text());
    eval(code);
  } catch(e) {
    alert('❌ Failed to load sniper: ' + e.message);
  }
})();
