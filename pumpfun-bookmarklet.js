javascript: (async function() {
  const BACKEND_URL = 'https://axiom-projects.vercel.app';
  
  try {
    const code = await fetch(BACKEND_URL + '/pumpfun-sniper.js').then(r => r.text());
    eval(code);
  } catch(e) {
    alert('❌ Failed to load sniper: ' + e.message);
  }
});
