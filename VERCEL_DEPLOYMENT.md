# Vercel Deployment Guide

## Quick Start (5 minutes)

### 1. Create Vercel Account
- Go to [vercel.com](https://vercel.com)
- Sign up with GitHub/email
- Create new project

### 2. Deploy This Code
```bash
# Option A: Connect GitHub repo
- Push this folder to GitHub
- Go to vercel.com/new
- Import your repository
- Deploy (automatic)

# Option B: Deploy CLI
npm install -g vercel
cd c:\Users\Dominic\Documents\Business\nebula\axiom-projects
vercel
```

### 3. Get Your URL
After deployment, Vercel will give you a URL like:
```
https://your-project-name.vercel.app
```

### 4. Update Code
Replace `https://synonymous-pamala-feudally.ngrok-free.dev` with your Vercel URL in:
- `pumpfun-bookmarklet.js`
- `pumpfun-sniper.js`
- `sniper.js` (if needed)

### 5. Test on pump.fun
- Go to pump.fun
- Click the ☘️ Sniper bookmark
- Should load now! ✅

## File Structure for Vercel

```
axiom-projects/
├── api/
│   └── index.js          (serverless function)
├── vercel.json           (config)
├── package.json          (dependencies)
├── backend.js            (local development)
├── pumpfun-sniper.js     (update URL here)
├── pumpfun-bookmarklet.js (update URL here)
├── sniper.js
└── index.html
```

## Environment Variables (Optional)
If you need to keep sensitive keys:
1. Go to Vercel Dashboard → Settings → Environment Variables
2. Add any secrets
3. Reference with `process.env.YOUR_KEY`

## Common Issues

**"Cannot find module"**
- Vercel needs package.json with all dependencies
- Check npm install runs correctly

**"404 on /pumpfun-sniper.js"**
- File paths need to be relative to api/
- Or copy files to api/ directory

**"CORS Error"**
- Already enabled in api/index.js
- Should work from pump.fun now

## Support
- Vercel Docs: https://vercel.com/docs
- Contact Vercel support: vercel.com/support
