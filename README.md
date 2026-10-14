# Payanam — Tamil Nadu Bus Tickets

A bus ticket booking website for **Chennai, Coimbatore, Erode and Tirupur**, built to deploy on [Vercel](https://vercel.com).

> ⚠️ **Sample data only.** Every operator, departure time, duration and fare is made up for demonstration. The payment step is a demo — no money is charged and no card or UPI details are collected.

The full technical write-up is in [`docs/Payanam-Technical-Document.pdf`](docs/Payanam-Technical-Document.pdf).

## Features

- Search all 12 directions between the four cities (6 buses each)
- Calendar date picker — **past dates are disabled** and also rejected by the API
- On today's date, buses that have already left show **Departed** (Indian Standard Time)
- Seat maps: 2+2 seater (40 seats) and sleeper with lower/upper decks (30 berths), up to 6 seats per booking
- Passenger details, demo payment, ticket with booking ID, "My Bookings"
- Double booking blocked: seats are claimed all-or-nothing inside the database
- Photo banner, popular-route shortcuts, bus illustrations, dark mode, works on phones

## Deploy on Vercel

1. In Vercel, choose **Add New → Project** and import this GitHub repository.
2. Leave the framework preset as **Other** and click **Deploy**. No build step is needed.

The site works straight away in **browser-only mode**: each visitor's bookings are saved in their own browser, and a note in the banner says so.

### Turn on shared seats (optional, free tier available)

To make a booked seat show as taken for **every** visitor, add a Redis database:

1. Open the project in Vercel → **Storage** → create an **Upstash for Redis** database and connect it to this project.
2. **Redeploy** the project so the new connection settings take effect.

The API reads the connection from either `KV_REST_API_URL` + `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. Once they're set, `/api/meta` reports `"storage": "shared"` and the site switches over automatically.

## Run locally

- **Quick look:** open `public/index.html` with any static file server. It runs in browser-only mode.
- **With the API:** install the [Vercel CLI](https://vercel.com/docs/cli) and run `vercel dev`. Add the Redis variables to a `.env.local` file to test shared mode.

## Project structure

```
public/index.html           Page markup
public/styles.css           Styling (light and dark)
public/app.js               Front end: calendar, search, seat map, checkout, ticket, storage modes
public/images/bus-hero.jpg  Banner photo
api/meta.js                 GET  /api/meta
api/buses/index.js          GET  /api/buses?from=&to=&date=
api/buses/[id]/seats.js     GET  /api/buses/:id/seats?date=
api/bookings/index.js       POST /api/bookings
api/bookings/[id].js        GET  /api/bookings/:id?phone=
lib/core.js                 Sample data, booking rules, Redis storage
vercel.json                 Serves the site from public/
docs/                       Technical document
```

## Changing the bus data

Edit the tables at the top of `lib/core.js` (`ROUTES`, `OPERATORS`, `BUS_TYPES`, `LONG_SCHEDULE`, `SHORT_SCHEDULE`). The same sample data is also copied into `public/app.js` for browser-only mode, so update both.

## Deployment check

- `/deploy-test/` — a page that shows whether the live build came from a GitHub push, and which commit.
- `/api/health` — the same information as JSON.
