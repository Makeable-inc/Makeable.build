# Makeable Ember landing page

This package contains the scroll-controlled Ember product story used by the
public Makeable landing page. It is isolated from the repository's existing
application so Netlify can build and deploy only this site.

## Run locally

```bash
npm install
npm run dev
```

Node.js 24 is required.

## Deploy on Netlify

Connect the repository and select `codex/landing` as the deploy branch. Set
the Netlify base directory to `apps/landing`. Netlify will then use this
package's `netlify.toml`, install only the landing dependencies, and deploy the
Next.js output without building the existing root application.

- Base directory: `apps/landing`
- Build command: `npm run build`
- Publish directory: `.next`

## Production checkout

Set `STRIPE_SECRET_KEY` in the deployment environment. The key must remain
server-side and must never be committed to this repository.

## Animation assets

- Desktop: `public/frames-v2` (301 optimized WebP frames)
- Mobile: `public/frames-mobile` (300 optimized WebP frames)

The page automatically selects the appropriate sequence for the visitor's
viewport while preserving the same four scroll-controlled scenes.
