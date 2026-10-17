# Client Clock

A small always-on-top card that sits in the top-right of your screen and tells you
what time it is **where your client is** — written the way you actually think about it:

```
Hershel   🇺🇸 New York · Eastern
1:12  Afternoon
Fri Oct 16
● Good time to message            10h behind you
```

No AM/PM anywhere. The hour is always paired with the part of the day.

## Day stages

| Local hour | Reads as | Follow-up verdict |
|---|---|---|
| 00:00–03:59 | late night | Asleep — do not message |
| 04:00–05:59 | early morning | Just waking up |
| 06:00–07:59 | morning | Early — good to land first |
| 08:00–10:59 | morning | **Prime follow-up window** |
| 11:00–11:59 | morning | Good time to message |
| 12:00–12:59 | noon | Lunch — expect a slow reply |
| 13:00–16:59 | afternoon | Good time to message |
| 17:00–19:59 | evening | Winding down — still fine |
| 20:00–23:59 | night | Late — better to wait |

The whole card takes the colour of the current stage, so a glance is enough.
Saturdays and Sundays get a `Weekend ·` prefix and downgrade a green verdict to amber.

## Auto-switching with Dribbble (the point of the thing)

Install the bridge once and the clock follows you around Dribbble: open a
conversation, and the card switches to that person's local time by itself.

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose `~/Downloads/client-clock/extension`.
4. Make sure the widget is running (`./start.sh`), then open any Dribbble
   conversation. The card shows a green **AUTO** badge with that person's name.

How it works: the extension reads only the person's name and the short lines of
their profile card — never your message contents — and posts them to the widget
on `127.0.0.1:8899`. That port is loopback-only and rejects any origin other
than Dribbble and the extension itself. Nothing leaves your machine, and if the
widget isn't running the extension just stays quiet.

It reads the page by geometry and text shape rather than by Dribbble's CSS class
names, so a Dribbble redesign won't silently break it.

### When the country has several zones

A profile that only says *United States* could be any of seven times. Instead of
guessing silently, the card shows an amber strip:

> United States spans 7 zones — showing Eastern. Which one is Alex?
> `Eastern 1:30` `Central 12:30` `Mountain 11:30` `Arizona 10:30` `Pacific 10:30` …

Each chip shows the live time in that zone. Click one and that person is pinned
to it **forever** — the strip never comes back for them, even after a restart.
Until you click, it shows the country's most common zone.

If the profile gives a city or a state (`Austin, TX`, `Brooklyn, NY`,
`Vancouver, BC`, `Osaka, Japan`), there's nothing to ask: it resolves exactly,
with no strip. If a profile shows no location at all, the card says so and you
set that person's zone once from the `⌄` panel.

## Collapsed and open

The widget has two states:

- **Collapsed** — a small tab squeezed against the right edge of the screen,
  showing your logo. This is how it sits when you are not on Dribbble at all.
  The dot on the tab carries the current stage colour of the last person you
  were talking to, and hovering it shows their name and local time.
- **Open** — the full card. It opens *by itself* the moment you land on
  Dribbble, and **stays open the whole time you are there** — the inbox, the
  feed, someone's shots, anywhere. Between conversations it keeps showing
  whoever you last opened, so the clock is already up when you jump back into a
  thread.

It collapses when you leave Dribbble entirely, or after a minute with no word
from Chrome at all (tab closed, Chrome quit). Switching to another app does
**not** collapse it — you can still glance at the clock while you work
somewhere else. Pressing `✕` keeps it shut until your next real conversation,
so it never fights you.

Click the tab to open it by hand; click `✕` on the card to put it back. `⌘⇧K`
still hides and shows the whole thing.

## Branding

The mark is an open **C** with a blue square (`#1B4DFF`) seated in its notch, on
a white tile — `assets/logo.svg`, with a tile-less version in `assets/mark.svg`.
The collapsed tab draws it as live SVG at the same proportions as the icon, the
menu-bar icon is its silhouette, and `extension/icons/` carries it into Chrome.

Motion is kept light: the tab slides out and the blue square lifts from its
notch on hover, the card slides in when a conversation opens, and the stage dot
breathes while someone is live. All of it is disabled under
`prefers-reduced-motion`.

To swap the mark, drop a square `logo.png` into `assets/` — it covers the
built-in one. Delete it to go back.

## Using it

- **Switch client** — click `⌄`, then click a name in *My clients*.
- **Add a client** — click `⌄`, type a country or city (`united states`, `canada`,
  `toronto`, `dubai`), pick the row, type the person's name, press Enter.
  Every search result shows its own live time, so you can see at a glance which
  zone a country is in before you commit.
- **Remove** — hover a saved row, click `✕`.
- **Move it** — drag the card anywhere. The position is remembered.
- **Hide / show** — `⌘⇧K`, the `✕` button, or the menu-bar clock icon.
- **Quit** — menu-bar clock icon → *Quit Client Clock*.

Clients, and every zone correction you've made, are stored in
`~/Library/Application Support/client-clock/config.json`.

Auto-detection takes over whenever you open a Dribbble conversation; clicking a
saved client pins the card manually until the next conversation you open.

## What it understands

**Every country on earth** — 419 time zones across 248 countries and
territories, generated straight from the IANA database that ships with macOS
(`/usr/share/zoneinfo/zone.tab`), so there is no list to keep topping up. On top
of that: every US state, Canadian province and Australian state, and ~400 major
cities, so `Austin, TX` lands on Central and not on Eastern.

Ambiguities are handled deliberately. Bare *Georgia* is the country while
*Atlanta, Georgia* is the US state; *Jersey* is the island but *Jersey City, NJ*
is not; and a person named Jordan is never mistaken for Amman.

Countries with many zones collapse to the handful of clocks that actually
differ — the US offers 8 choices, not its 29 IANA zones. Two zones count as the
same clock only if they agree in **both January and July**, so Phoenix never
hides behind Los Angeles just because they happen to match in summer.

To refresh after a macOS timezone-data update:

```bash
node tools-genzones.js
```

## Run

```bash
./start.sh
```

## Always on

It installs a launchd agent (`~/Library/LaunchAgents/com.aman.client-clock.plist`)
on first run, so it starts at login and is already waiting before you open
Chrome. If it ever crashes, launchd restarts it.

Quitting from the tray stays quit — a clean exit is respected, only crashes are
revived. To stop it starting at login, untick **Start at login** in the tray
menu; that unloads the agent and deletes the plist.

```bash
launchctl kickstart gui/$UID/com.aman.client-clock   # start it right now
launchctl unload -w ~/Library/LaunchAgents/com.aman.client-clock.plist
```
