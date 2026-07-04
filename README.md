# Marked Hearts

Marked Hearts is a static, offline-capable deduction card game for 2–8 players. It uses an original tattoo-flash theme and a rules engine based on the 2016 Premium ruleset.

## Play

The live game is published at:

**https://frankstop.github.io/LoveLetter/**

Choose any mix of hot-seat humans and AI players. Games with 2–4 players use the 16-card core deck; games with 5–8 players automatically use all 32 cards.

## Run locally

No build step or dependencies are required.

```sh
npm run serve
```

Open `http://localhost:8000`. A local HTTP server is required because service workers and JavaScript modules do not run correctly from a `file://` URL.

Run the engine tests with:

```sh
npm test
npm run check
```

## PWA and saved games

- The service worker caches the complete app shell after the first successful load.
- Game state and settings are stored in the current browser with `localStorage`.
- On iPhone or iPad, open the site in Safari, tap **Share**, then **Add to Home Screen**.
- Saved games do not sync between browsers or devices.

## Deployment

GitHub Pages serves the repository root from `main`. The application uses relative URLs so it works under the `/LoveLetter/` project path.

## Credits and scope

All names, interface artwork, SVG illustrations, and visual assets in this repository are original. No artwork from Love Letter is included.

Marked Hearts is an unofficial fan-made implementation inspired by the game mechanics described in the publicly available Love Letter Premium rulebook. It is not affiliated with or endorsed by the original publisher.

There is no backend, online multiplayer, account system, or analytics.

