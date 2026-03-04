# zq1anddar0 Home Page

A personal household webpage for zq1 and dar0. It serves as a home hub for Wi-Fi info, Alexa commands, room pages, and a full household inventory manager.

**Live site:** https://zq1anddar0-87090b577d02.herokuapp.com/

---

## Features

### Home (`index.html`)
- Wi-Fi password display
- Alexa command quick-reference list
- **Find My Stuff** — search bar that redirects to the inventory page, plus a live alert badge showing how many items need attention

### Find My Stuff / Inventory (`pages/search.html`)
- **Browse all items** in a responsive card grid
- **Filter** by classification: Food, Medicine, Cleaning, Electronics, General
- **Live search** by name, location, or description
- **Add items** with: name, description, classification, location, quantity, expiration date, and a photo (file upload or URL)
- **Edit / Delete** any item
- **Alert notifications** — a banner flags items that need attention:
  - Out of stock (qty = 0)
  - Low stock (qty ≤ 2 for consumables)
  - Expiring soon (within 14 days)
  - Expired
- Data is stored in **localStorage** — no account needed, works offline

### Room Pages
| Page | Path |
|------|------|
| zq1's Room | `/pages/zq1.html` |
| dar0's Room | `/pages/dar0.html` |
| Living Room | `/pages/living.html` |

dar0's room includes a Google Calendar schedule embed and Alexa command list.

---

## Project Structure

```
├── index.html              # Home page
├── server.js               # Express server (Heroku)
├── package.json
├── items.json              # Legacy seed data (superseded by localStorage)
├── pages/
│   ├── search.html         # Inventory manager
│   ├── nav.html            # Shared navbar (injected via fetch)
│   ├── zq1.html
│   ├── dar0.html
│   └── living.html
├── js/
│   ├── inventory.js        # Inventory CRUD, search, notifications
│   ├── search.js           # Home page search redirect
│   └── nav.js              # Navbar loader + mobile toggle
├── css/
│   └── style.css
└── assets/
    ├── wifi.png
    ├── zq1.jpg
    ├── dar0.jpg
    ├── living.jpg
    └── ...
```

---

## Running Locally

```bash
npm install
npm start
```

Then open **http://localhost:3000**

---

## Deploying to Heroku

The app is already configured for Heroku. To push updates:

```bash
git add .
git commit -m "your message"
git push heroku main
```

Make sure the Heroku remote is set:

```bash
heroku git:remote -a zq1anddar0
```

---

## Tech Stack

- Plain HTML, CSS, JavaScript (no framework)
- Node.js + Express (REST API + static file server)
- MongoDB Atlas (cloud database for inventory)
- Hosted on Heroku
