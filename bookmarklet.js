javascript: (async function () {
  try {
    const res = await fetch('http://localhost:3001/sniper.js');
    const code = await res.text();
    eval(code);
  } catch (e) {
    console.error('Failed to load sniper:', e);
    alert('Sniper server not available. Make sure backend is running on port 3001.');
  }
})();
