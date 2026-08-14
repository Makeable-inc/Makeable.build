# Makeable Ember landing page

This branch includes the scroll-controlled Ember product story used by the
public Makeable landing page.

## Run locally

```bash
npm install
npm run dev
```

Node.js 22.13 or newer is required.

## Production checkout

Set `STRIPE_SECRET_KEY` in the deployment environment. The key must remain
server-side and must never be committed to this repository.

## Animation assets

- Desktop: `public/frames-v2` (301 optimized WebP frames)
- Mobile: `public/frames-mobile` (300 optimized WebP frames)

The page automatically selects the appropriate sequence for the visitor's
viewport while preserving the same four scroll-controlled scenes.
