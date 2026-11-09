# Tabstead: store listing draft (addons.mozilla.org)

## Name
Tabstead: Workspaces and Tab Groups

## Summary (250 characters at most)
Workspaces for Firefox, built on Firefox's own tab groups. Switch between sets of tabs in one click. Tabs you are not using are put away, never closed, and Tabstead brings back anything Firefox didn't reopen.

## Description
Keep a workspace for work, one for a project and one for reading. Click a workspace in the sidebar and its tabs come back exactly as you left them, Firefox tab groups and all. The other workspaces' tabs are put away, never closed.

Never lose a tab
- Tabstead hides and shows tabs. It never closes one to switch. The first time, Firefox asks about the hidden tabs: choose Keep Tabs Hidden.
- It keeps a copy of every workspace. When Firefox starts without reopening your last session, Tabstead brings back what is missing, and never opens a tab twice.
- Picking a hidden tab from Firefox's list of all tabs takes you to its workspace.
- A tab you reopen with Ctrl+Shift+T comes back where you can see it.
- When a window closes with hidden tabs in it, the sidebar offers to bring the whole window back.
- One button shows every hidden tab, whatever happens.

Made for Firefox tab groups
- Groups live inside their workspace and stay whole. The tab bar shows only the groups of the workspace you are in, and each one comes back with its name and colour.
- Right-click a tab and choose Move to workspace. A tab in a group takes its whole group along.
- Open any workspace in a window of its own.

Find anything
- Search finds a tab in any workspace and takes you to it.
- Alt+Shift+W opens the sidebar. Alt+Shift+Page Down and Page Up go to the next and previous workspace.

Backups
- A restore point every 30 minutes when something changed, the last 20 kept.
- Save a backup file with the date and time in its name.
- Import a Tabstead or Simple Tab Groups backup. Each group becomes a workspace.
- Restores open tabs unloaded, a few at a time, so 500 tabs restore without slowing Firefox down.

Private
Tabstead collects nothing and sends nothing anywhere. Everything stays in your Firefox profile.

Firefox 140 or later on Windows, Mac and Linux.

## Category
Tabs

## Tags
workspaces, tab groups, tab manager, sessions, productivity

## Permissions, in plain words (for the review notes)
- Hide tabs: to put away the tabs of the workspaces you are not using.
- Tab groups: to keep Firefox tab groups whole when they move between workspaces and windows.
- Tabs and sessions: to know which workspace each tab is in (stored by Firefox's own session store) and to bring back a closed window.
- Storage and unlimited storage: the workspace list, the copy used for recovery, and restore points, all on your computer.
- Menus: Move to workspace on the tab's right-click menu.
- Alarms: a restore point every 30 minutes.

## Notes for the reviewer
No remote code, no network requests, no data collection. Source is plain JavaScript with no build step beyond copying
files. The tests in test/ run it in a real Firefox.
