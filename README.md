# SATUNO Bitcoin Pricing — Shopify App 🟠

Adds live Bitcoin (sats) pricing to any Shopify store.

## Setup

1. Clone this repo
2. Copy `.env.example` to `.env` and fill in your credentials
3. `npm install`
4. `npm start`

## Environment variables

```
SHOPIFY_API_KEY=your_client_id
SHOPIFY_API_SECRET=your_client_secret
SHOPIFY_SCOPES=read_products,read_themes,write_themes
APP_URL=https://your-railway-app.up.railway.app
SESSION_SECRET=random_string_here
SATUNO_API_URL=https://satuno-api-production.up.railway.app
```

## Install on a store

```
https://YOUR_APP_URL/?shop=STORE.myshopify.com
```

Built by SATUNO — Bitcoin, made useful. 🟠
