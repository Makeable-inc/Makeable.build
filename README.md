# Makeable Ember landing page

This branch contains only the scroll-controlled Moment in Motion experience
for Makeable Ember. It has an independent Git history and no application files
inherited from the repository's `main` branch.

## Run locally

```bash
npm install
npm run dev
```

Node.js 24 is required.

## Deploy on Netlify

Connect the repository and select `codex/moment-in-motion-netlify` as the
production branch. The site lives at the branch root, so leave the Netlify base
directory empty. Netlify will detect the included Next.js configuration.

- Base directory: leave empty
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
