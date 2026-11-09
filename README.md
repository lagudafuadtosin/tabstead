# Tabstead: Workspaces and Tab Groups

Workspaces for Firefox, built on Firefox's own tab groups. Keep a set of tabs for work, one for a project, one for
reading, and switch between them in one click. The tabs you are not using are put away, never closed.

## What it does

- **Workspaces in the sidebar.** Click to switch. Double-click to rename. Click the dot to change the colour.
- **Firefox tab groups stay whole.** A group lives inside its workspace and comes back exactly as you left it.
- **Move to workspace** from the tab's right-click menu. A tab in a group takes its whole group along.
- **Search** finds a tab in any workspace and takes you straight to it.
- **Pinned tabs** show in every workspace.
- **Keyboard:** Alt+Shift+W opens the sidebar. Alt+Shift+Page Down and Page Up go to the next and previous workspace.
  In the sidebar, Enter switches, F2 renames, Alt+Up and Alt+Down move a workspace in the list.

## Never lose a tab

- Tabstead never closes a tab to switch. It only hides and shows tabs, and works out what to show from each tab's
  workspace, kept by Firefox's own session store.
- It keeps a copy of every workspace. When Firefox starts without reopening your last session, or reopens only part of
  it, Tabstead brings back what is missing. A tab that is already open is never opened twice.
- Picking a hidden tab from Firefox's list of all tabs, or with "Switch to tab", takes you to its workspace.
- A tab you reopen with Ctrl+Shift+T comes back into the workspace you are in, where you can see it.
- When a window closes with hidden tabs in it, the sidebar offers to bring the whole window back.
- **Show all hidden tabs** puts every hidden tab in view, in the workspace you are in.

## Backups

- A restore point is made every 30 minutes when something changed. The last 20 are kept.
- **Save to a file** saves a backup with the date and time in the file name.
- **Import a file** takes a Tabstead backup or a **Simple Tab Groups** backup. Each group becomes a workspace.
- A restore adds back the tabs that are missing. Nothing is closed and nothing is opened twice. Restored tabs open
  unloaded, a few at a time, so even 500 tabs restore without slowing Firefox down.

## Privacy

Tabstead collects nothing and sends nothing anywhere. Everything stays in your Firefox profile.

## Needs

Firefox 140 or later on Windows, Mac or Linux. Firefox for Android has no way for an add-on to hide tabs, so Tabstead
is for desktop Firefox.

## Tests

`npm test` builds the add-on and runs every test, one Firefox at a time:

- `test/model.mjs`: the rules on their own, with a 20,000-step random run.
- `test/firefox.mjs`, `test/features.mjs`: real Firefox. Switching, groups, moves between windows, reopened tabs,
  hidden tabs picked from Firefox's list, closed windows, search, backups, a Simple Tab Groups import and a 500-tab restore.
- `test/sidebar.mjs`: the sidebar driven with real clicks and typing.
- `test/restart.mjs`, `test/startup.mjs`: Firefox killed hard, in the middle of a switch too, and started again, with
  session restore on and off.
- `test/stress.mjs`: hundreds of random things a person does, with Firefox killed and restarted along the way. After
  every step, every tab must exist exactly once, in its workspace.

The restart tests use Firefox Developer Edition (`FIREFOX_DEV`), since only an installed add-on survives a restart.
